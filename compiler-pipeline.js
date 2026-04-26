// Phase 5: Real Compiler Pipeline
// High-level script → Parsed statements → IR → GCOM (via profile mapping)
// This is the foundation for higher-level scripting with cross-controller portability.

/**
 * Parse high-level script into normalized statements.
 * Supports both direct GCOM (line-numbered) and future high-level opcodes.
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

    // For now, accept both GCOM line-numbered format and pass through
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

    // Future: Tier 1 opcode parsing will go here
    // For now, treat unrecognized lines as potential errors
    warnings.push(`Line ${lineNum}: unrecognized format (expected "LINE_NUM STATEMENT")`);
  });

  return { success: errors.length === 0, statements, errors, warnings };
}

/**
 * Lower parsed statements to IR nodes.
 * Maps GCOM/opcodes to abstract IR representation.
 * 
 * Returns: { success, irNodes[], errors[], warnings[] }
 */
function lowerToIR(statements, profile = null) {
  const irNodes = [];
  const errors = [];
  const warnings = [];

  statements.forEach(stmt => {
    if (stmt.type === 'gcom_direct') {
      // For stage-1: pass through GCOM directly as diagnostic IR node
      irNodes.push(createIRNode(
        IR_NODE_TYPES.DIAGNOSTICS,
        stmt.sourceLineNum,
        {
          kind: 'gcom_passthrough',
          content: stmt.content,
          lineNumber: stmt.lineNumber
        }
      ));
    }
  });

  return { success: errors.length === 0, irNodes, errors, warnings };
}

/**
 * Generate GCOM from IR nodes using profile lowering rules.
 * For stage-1: pass through IR diagnostic nodes as-is.
 * 
 * Returns: { success, gcom: string, diagnostics: [] }
 */
function generateGCOMFromIR(irNodes, profile = null) {
  const lines = [];
  const diagnostics = [];

  irNodes.forEach(node => {
    if (node.type === IR_NODE_TYPES.DIAGNOSTICS && node.payload.kind === 'gcom_passthrough') {
      lines.push(`${node.payload.lineNumber} ${node.payload.content}`);
    }
  });

  return {
    success: true,
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
      metadata: { stage: 'parse-error', profile_id: profile?.id }
    };
  }

  const lowerResult = lowerToIR(parseResult.statements, profile);
  if (!lowerResult.success) {
    return {
      success: false,
      gcom: '',
      ir: lowerResult.irNodes,
      diagnostics: lowerResult.errors,
      metadata: { stage: 'lower-error', profile_id: profile?.id }
    };
  }

  const genResult = generateGCOMFromIR(lowerResult.irNodes, profile);
  if (!genResult.success) {
    return {
      success: false,
      gcom: '',
      ir: lowerResult.irNodes,
      diagnostics: genResult.diagnostics,
      metadata: { stage: 'codegen-error', profile_id: profile?.id }
    };
  }

  return {
    success: true,
    gcom: genResult.gcom,
    ir: lowerResult.irNodes,
    diagnostics: [...parseResult.warnings, ...lowerResult.warnings, ...genResult.diagnostics],
    metadata: {
      stage: 'stage-1-real-pipeline',
      profile_id: profile && typeof profile.id === 'string' ? profile.id : null,
      tier1_opcodes_encountered: 0,
      ir_nodes_generated: lowerResult.irNodes.length
    }
  };
}
