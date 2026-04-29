// Phase 5: Real Compiler Pipeline
// High-level script → classified statements → direct GCOM (via profile rule_set lookup)
// This slice handles a fixed abstract keyword set and keeps direct GCOM passthrough intact.

const ABSTRACT_KEYWORDS = new Set(['HOME', 'STATUS', 'RESET', 'SPINDLE_ON', 'PROBE']);

function getProfileId(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (profile.machine_description && typeof profile.machine_description === 'object') {
    const machineId = profile.machine_description.id;
    if (typeof machineId === 'string' && machineId.trim()) return machineId.trim();
  }
  if (typeof profile.id === 'string' && profile.id.trim()) return profile.id.trim();
  return null;
}

function getProfileKeywordRule(profile, keyword) {
  if (!profile || typeof profile !== 'object') return null;
  const ruleSet = profile.rule_set && typeof profile.rule_set === 'object' ? profile.rule_set : null;
  if (!ruleSet) return null;
  const rule = ruleSet[keyword];
  if (!rule || typeof rule !== 'object') return null;
  return rule;
}

function getProfileMachineDescription(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (profile.machine_description && typeof profile.machine_description === 'object') {
    return profile.machine_description;
  }
  return profile;
}

function buildKeywordEmission(keyword, rule, argsText = '') {
  if (!rule || typeof rule !== 'object') {
    return { error: `missing rule for ${keyword}` };
  }

  if (rule.unsupported === true) {
    const warning = Array.isArray(rule.feature_guard_warnings) && rule.feature_guard_warnings.length
      ? String(rule.feature_guard_warnings[0].message || '').trim()
      : `${keyword} is unsupported for the active profile`;
    return { warning: warning || `${keyword} is unsupported for the active profile` };
  }

  let emit = typeof rule.emit === 'string' ? rule.emit.trim() : '';
  if (!emit) {
    return { error: `rule for ${keyword} does not define emit` };
  }

  if (keyword === 'SPINDLE_ON') {
    const powerArg = String(argsText || '').trim().split(/\s+/)[0] || '';
    emit = emit.replaceAll('{power}', powerArg || '');
  }

  return { emit };
}

/**
 * Parse high-level script into normalized statements.
 * Supports comments/metadata, direct line-numbered GCOM, and fixed abstract keywords.
 * 
 * Returns: { success, statements[], errors[], warnings[] }
 */
function parseHighLevelScript(source) {
  const statements = [];
  const errors = [];
  const warnings = [];
  const lines = source.split('\n');

  lines.forEach((line, lineIdx) => {
    const lineNum = lineIdx + 1;
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith('REM') || trimmed.startsWith(';')) {
      return; // Skip comments and empty lines
    }

    // Try GCOM line-numbered format first
    const gcodeMatch = trimmed.match(/^(\d+)\s+(.+)$/);
    if (gcodeMatch) {
      const lineNumber = parseInt(gcodeMatch[1], 10);
      const content = gcodeMatch[2];
      statements.push({
        type: 'gcom_direct',
        lineNumber,
        content,
        sourceLineNum: lineNum
      });
      return;
    }

    const keywordMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\b(.*)$/i);
    if (keywordMatch) {
      const keyword = keywordMatch[1].toUpperCase();
      if (ABSTRACT_KEYWORDS.has(keyword)) {
        statements.push({
          type: 'abstract_keyword',
          keyword,
          argsText: String(keywordMatch[2] || '').trim(),
          sourceLineNum: lineNum,
          rawLine: trimmed
        });
        return;
      }
    }

    // Unrecognized format
    warnings.push(`Line ${lineNum}: unrecognized format (expected "LINE_NUM GCODE", "HOME", or comment)`);
  });

  return { success: errors.length === 0, statements, errors, warnings };
}

/**
 * Lower parsed statements to lightweight compile nodes.
 * This slice avoids the Tier-1 opcode IR path and keeps only the data needed for stage-1 generation.
 * 
 * Returns: { success, irNodes[], errors[], warnings[] }
 */
function lowerToIR(statements, profile = null) {
  const irNodes = [];
  const errors = [];
  const warnings = [];

  statements.forEach(stmt => {
    if (stmt.type === 'gcom_direct') {
      irNodes.push({
        type: 'gcom_passthrough',
        sourceLineNum: stmt.sourceLineNum,
        payload: {
          content: stmt.content,
          lineNumber: stmt.lineNumber
        }
      });
    } else if (stmt.type === 'abstract_keyword') {
      irNodes.push({
        type: 'abstract_keyword',
        sourceLineNum: stmt.sourceLineNum,
        payload: {
          keyword: stmt.keyword,
          argsText: stmt.argsText,
          rawLine: stmt.rawLine
        }
      });
    }
  });

  return { success: errors.length === 0, irNodes, errors, warnings };
}

/**
 * Generate GCOM from compile nodes using direct profile rule_set lowering.
 * For this slice, abstract keywords are lowered by profile rule_set. Direct GCOM passes through unchanged.
 * 
 * Returns: { success, gcom: string, diagnostics: [] }
 */
function generateGCOMFromIR(irNodes, profile = null) {
  const lines = [];
  const diagnostics = [];
  let lineNum = 1;
  const machine = getProfileMachineDescription(profile);
  const maxFeedRate = Number(machine && machine.max_feed_rate);
  const enforceMaxFeedRate = Number.isFinite(maxFeedRate) && maxFeedRate > 0;
  const arcSupport = machine && typeof machine.arc_support === 'boolean' ? machine.arc_support : true;

  irNodes.forEach(node => {
    if (node.type === 'gcom_passthrough') {
      const content = String(node.payload.content || '');

      if (enforceMaxFeedRate) {
        const feedRegex = /F(\d+)/gi;
        let match;
        while ((match = feedRegex.exec(content))) {
          const feed = parseInt(match[1], 10);
          if (feed > maxFeedRate) {
            diagnostics.push(`Warning: Line ${node.sourceLineNum}: Feed rate ${feed} exceeds max (${maxFeedRate}) for this machine.`);
          }
        }
      }

      if (!arcSupport && /\bG0?[23]\b/i.test(content)) {
        diagnostics.push(`Error: Line ${node.sourceLineNum}: Arcs (G2/G3) are not supported on this machine.`);
      }

      // Pass through GCOM line as-is
      lines.push(`${node.payload.lineNumber} ${node.payload.content}`);
      lineNum = Math.max(lineNum, node.payload.lineNumber + 1);
    } else if (node.type === 'abstract_keyword') {
      const keyword = node.payload.keyword;
      const rule = getProfileKeywordRule(profile, keyword);
      if (!rule) {
        diagnostics.push(`Error: Line ${node.sourceLineNum}: Missing ${keyword} rule for profile ${getProfileId(profile) || 'unknown'}`);
        return;
      }

      const emission = buildKeywordEmission(keyword, rule, node.payload.argsText);
      if (emission.error) {
        diagnostics.push(`Error: Line ${node.sourceLineNum}: ${emission.error}`);
        return;
      }
      if (emission.warning) {
        diagnostics.push(`Warning: Line ${node.sourceLineNum}: ${emission.warning}`);
        return;
      }

      lines.push(`${lineNum} ${emission.emit}`);
      lineNum++;
    }
  });

  const hasErrors = diagnostics.some(d => String(d).startsWith('Error:'));

  return {
    success: !hasErrors,
    gcom: lines.join('\n'),
    diagnostics
  };
}

/**
 * Full compile pipeline: source → IR → GCOM
 * Stage-1 is pass-through; later stages will implement real transformations.
 * 
 * Returns: { success, gcom, ir, diagnostics, metadata }
 */
function compileWithRealPipeline(source, profile = null) {
  const parseResult = parseHighLevelScript(source);
  if (!parseResult.success) {
    return {
      success: false,
      gcom: '',
      ir: [],
      diagnostics: parseResult.errors,
      metadata: { stage: 'parse-error', profile_id: getProfileId(profile) }
    };
  }

  const lowerResult = lowerToIR(parseResult.statements, profile);
  if (!lowerResult.success) {
    return {
      success: false,
      gcom: '',
      ir: lowerResult.irNodes,
      diagnostics: lowerResult.errors,
      metadata: { stage: 'lower-error', profile_id: getProfileId(profile) }
    };
  }

  const genResult = generateGCOMFromIR(lowerResult.irNodes, profile);
  if (!genResult.success) {
    return {
      success: false,
      gcom: '',
      ir: lowerResult.irNodes,
      diagnostics: genResult.diagnostics,
      metadata: { stage: 'codegen-error', profile_id: getProfileId(profile) }
    };
  }

  return {
    success: true,
    gcom: genResult.gcom,
    ir: lowerResult.irNodes,
    diagnostics: [...parseResult.warnings, ...lowerResult.warnings, ...genResult.diagnostics],
    metadata: {
      stage: 'stage-1-real-pipeline',
      profile_id: getProfileId(profile),
      abstract_keywords_encountered: parseResult.statements.filter(stmt => stmt.type === 'abstract_keyword').length,
      ir_nodes_generated: lowerResult.irNodes.length
    }
  };
}
