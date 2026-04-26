// Phase 5: Real Compiler Pipeline
// High-level script → Parsed statements → IR → GCOM (via profile mapping)
// This is the foundation for higher-level scripting with cross-controller portability.

/**
 * Parse high-level script into normalized statements.
 * Supports both direct GCOM (line-numbered) and high-level opcodes.
 * 
 * Returns: { success, statements[], errors[], warnings[] }
 */
function parseHighLevelScript(source) {
  const statements = [];
  const errors = [];
  const warnings = [];
  const lines = source.split('\n');

  // Build Tier 1 opcode names for regex
  const tier1Names = Object.keys(TIER1_OPCODES || {});
  const opcodePattern = tier1Names.length > 0 
    ? new RegExp(`^(${tier1Names.join('|')})\\b`, 'i')
    : null;

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

    // Try Tier 1 opcode parsing
    if (opcodePattern) {
      const opcodeMatch = trimmed.match(opcodePattern);
      if (opcodeMatch) {
        const opcode = opcodeMatch[1].toUpperCase();
        const args = trimmed.substring(opcodeMatch[0].length).trim();
        
        // Parse arguments (key=value pairs or positional)
        const argMap = {};
        if (args) {
          // Try key=value format first
          const kvPairs = args.split(/\s+/);
          kvPairs.forEach(pair => {
            const [key, value] = pair.split('=');
            if (key && value !== undefined) {
              argMap[key.toUpperCase()] = value;
            } else if (key) {
              // Positional argument: treated as flags or axis spec
              argMap[key.toUpperCase()] = true;
            }
          });
        }
        
        statements.push({
          type: 'opcode',
          opcode,
          args: argMap,
          sourceLineNum: lineNum,
          rawLine: trimmed
        });
        return;
      }
    }

    // Unrecognized format
    warnings.push(`Line ${lineNum}: unrecognized format (expected "LINE_NUM GCODE", "OPCODE [args]", or comment)`);
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
      // Pass through GCOM directly as diagnostic IR node
      irNodes.push(createIRNode(
        IR_NODE_TYPES.DIAGNOSTICS,
        stmt.sourceLineNum,
        {
          kind: 'gcom_passthrough',
          content: stmt.content,
          lineNumber: stmt.lineNumber
        }
      ));
    } else if (stmt.type === 'opcode') {
      // Map Tier 1 opcode to IR node
      const opcodeId = stmt.opcode.toUpperCase();
      const opcodedef = TIER1_OPCODES && TIER1_OPCODES[opcodeId];
      
      if (!opcodedef) {
        errors.push(`Line ${stmt.sourceLineNum}: unknown opcode '${stmt.opcode}'`);
        return;
      }
      
      // Map opcode to IR type
      let irType = IR_NODE_TYPES.DIAGNOSTICS;
      if (opcodedef.category === 'motion') {
        irType = IR_NODE_TYPES.MOTION;
      } else if (opcodedef.category === 'state') {
        irType = IR_NODE_TYPES.STATE_CHANGE;
      } else if (opcodedef.category === 'setup') {
        irType = IR_NODE_TYPES.SETUP;
      } else if (opcodedef.category === 'tool') {
        irType = IR_NODE_TYPES.TOOL_EVENT;
      } else if (opcodedef.category === 'probe') {
        irType = IR_NODE_TYPES.PROBE_EVENT;
      } else if (opcodedef.category === 'io') {
        irType = IR_NODE_TYPES.IO_EVENT;
      }
      
      // Create IR node with opcode payload
      const irNode = createIRNode(irType, stmt.sourceLineNum, {
        kind: 'opcode',
        opcode: opcodeId,
        args: stmt.args,
        opcodedef: opcodedef
      });
      
      irNodes.push(irNode);
    }
  });

  return { success: errors.length === 0, irNodes, errors, warnings };
}

/**
 * Generate GCOM from IR nodes using profile lowering rules.
 * For stage-1: pass through GCOM, emit opcodes as comments with diagnostic hints.
 * Future stages: use profile.v2_preview.compile.abstract_ops for opcode→GCOM mapping.
 * 
 * Returns: { success, gcom: string, diagnostics: [] }
 */
function generateGCOMFromIR(irNodes, profile = null) {
  const lines = [];
  const diagnostics = [];
  let lineNum = 1;

  irNodes.forEach(node => {
    if (node.type === IR_NODE_TYPES.DIAGNOSTICS && node.payload.kind === 'gcom_passthrough') {
      // Pass through GCOM line as-is
      lines.push(`${node.payload.lineNumber} ${node.payload.content}`);
      lineNum = Math.max(lineNum, node.payload.lineNumber + 1);
    } else if (node.payload.kind === 'opcode') {
      // Emit opcode as GCODE comment with diagnostics
      const opcodeId = node.payload.opcode;
      const opcodedef = node.payload.opcodedef;
      const argsStr = Object.entries(node.payload.args)
        .map(([k, v]) => v === true ? k : `${k}=${v}`)
        .join(' ');
      
      // Generate GCODE from opcode (stage-1: use opcode→emit mapping or emit comment)
      let gcode = `; [OPCODE:${opcodeId}]`;
      
      if (profile && profile.v2_preview && profile.v2_preview.compile && profile.v2_preview.compile.abstract_ops) {
        const opcodeMapping = profile.v2_preview.compile.abstract_ops[opcodeId];
        if (opcodeMapping && opcodeMapping.emit) {
          gcode = opcodeMapping.emit;
          if (opcodeMapping.wait) {
            gcode += ` ; wait=${opcodeMapping.wait}`;
          }
        } else {
          diagnostics.push(`Warning: Line ${node.sourceLineNum}: No profile mapping for opcode ${opcodeId}; emitting as comment`);
        }
      } else if (typeof getOpcodeMapping === 'function') {
        const mapping = getOpcodeMapping(opcodeId, profile);
        if (mapping && mapping.gcode) {
          gcode = mapping.gcode;
          if (mapping.wait) {
            gcode += ` ; wait=${mapping.wait}`;
          }
        }
      }
      
      lines.push(`${lineNum} ${gcode}`);
      lineNum++;
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
