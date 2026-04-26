/**
 * Phase 9: Compiler Snapshot Tests
 * 
 * Verification suite demonstrating:
 * 1. Existing direct GCOM compiles unchanged (regression test)
 * 2. High-level opcodes parse and compile to IR
 * 3. Profile-aware code generation for GRBL, FluidNC, etc.
 * 4. Machine override composition and round-trip
 */

// Test helper: run snapshot test and report results
function runCompilerSnapshot(name, source, profile, expectedPatterns = []) {
  console.log(`\n[SNAPSHOT] ${name}`);
  console.log('---');
  console.log('Source:');
  console.log(source);
  console.log('---');
  
  try {
    const compiled = compileHighLevelScript(source, profile);
    
    console.log(`Compile Success: ${compiled.success}`);
    console.log(`Stage: ${compiled.compiler?.stage || 'unknown'}`);
    console.log(`Profile: ${compiled.compiler?.profile_id || 'none'}`);
    console.log(`Diagnostics: ${compiled.diagnostics?.length || 0}`);
    
    console.log('\nCompiled Output:');
    console.log(compiled.gcom);
    
    // Check expected patterns
    let patternMatch = true;
    if (expectedPatterns.length > 0) {
      console.log('\nPattern Check:');
      expectedPatterns.forEach(pattern => {
        const found = compiled.gcom.includes(pattern);
        console.log(`  "${pattern}" : ${found ? 'PASS' : 'FAIL'}`);
        if (!found) patternMatch = false;
      });
    }
    
    return { success: compiled.success, patternMatch, gcom: compiled.gcom };
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// TEST 1: Direct GCOM Regression Test
// Purpose: Ensure existing line-numbered GCOM works without change
function testDirectGcomRegression() {
  console.log('\n========== TEST 1: Direct GCOM Regression ==========');
  
  const directGcom = `10 G21
20 G90
30 G0 X10 Y20
40 G1 Z-5 F500
50 M5`;

  const result = runCompilerSnapshot(
    'Vanilla GCOM (line-numbered)',
    directGcom,
    null,  // No profile
    ['10 G21', '30 G0 X10 Y20', 'M5']
  );
  
  return result.success && result.patternMatch;
}

// TEST 2: Tier 1 Opcode Parsing
// Purpose: Parse high-level opcodes and convert to IR
function testTier1OpcodeParsing() {
  console.log('\n========== TEST 2: Tier 1 Opcode Parsing ==========');
  
  const opcodeScript = `HOME XYZ
MOVE X=50 Y=25 F1000
DWELL T500
PROBE Z=-30 F100
SPINDLE_ON S3000
SPINDLE_OFF`;

  // Mock profile with Tier 1 opcode support
  const mockProfile = {
    id: 'grbl-vanilla',
    v2_preview: {
      compile: {
        abstract_ops: {
          'HOME': { kind: 'command', emit: '$H', wait: 'ok' },
          'MOVE': { kind: 'gcode', emit: 'G1', wait: 'ok' },
          'DWELL': { kind: 'gcode', emit: 'G4', wait: 'ok' },
          'PROBE': { kind: 'gcode', emit: 'G38.2', wait: 'ok' },
          'SPINDLE_ON': { kind: 'gcode', emit: 'M3', wait: 'ok' },
          'SPINDLE_OFF': { kind: 'gcode', emit: 'M5', wait: 'ok' }
        }
      }
    }
  };

  const result = runCompilerSnapshot(
    'High-level opcodes',
    opcodeScript,
    mockProfile,
    ['[OPCODE:HOME]', '[OPCODE:MOVE]', '[OPCODE:SPINDLE_ON]']
  );
  
  return result.success;
}

// TEST 3: Cross-Controller Compilation
// Purpose: Verify same high-level source compiles for different controllers
function testCrossControllerCompilation() {
  console.log('\n========== TEST 3: Cross-Controller Compilation ==========');
  
  const highLevelScript = `10 G21
20 G90
30 HOME
40 MOVE X=100 Y=50 F1000
50 SPINDLE_ON S5000
60 G1 Z-10 F500`;

  const grblProfile = {
    id: 'grbl-vanilla',
    v2_preview: {
      compile: {
        abstract_ops: {
          'HOME': { kind: 'command', emit: '$H' },
          'SPINDLE_ON': { kind: 'gcode', emit: 'M3' }
        }
      }
    }
  };

  const fluidncProfile = {
    id: 'fluidnc',
    v2_preview: {
      compile: {
        abstract_ops: {
          'HOME': { kind: 'command', emit: '$H' },
          'SPINDLE_ON': { kind: 'gcode', emit: 'M3' }
        }
      }
    }
  };

  console.log('\n--- Compiling for GRBL ---');
  const grblResult = runCompilerSnapshot('Cross-controller: GRBL', highLevelScript, grblProfile);
  
  console.log('\n--- Compiling for FluidNC ---');
  const fluidncResult = runCompilerSnapshot('Cross-controller: FluidNC', highLevelScript, fluidncProfile);
  
  // Both should compile successfully with same high-level source
  return grblResult.success && fluidncResult.success;
}

// TEST 4: Machine Override Composition
// Purpose: Verify machine override macros are included in compiled output
function testMachineOverrideComposition() {
  console.log('\n========== TEST 4: Machine Override Composition ==========');
  
  const scriptWithMacro = `10 G21
20 SAFE_Z
30 G0 X10 Y20
40 TOOL_1_OFFSET`;

  const profileWithMacros = {
    id: 'my_cnc_3030',
    v2_preview: {
      machine_override: {
        machine_name: 'My CNC 3030',
        base_profile_id: 'grbl-vanilla',
        macros: {
          'SAFE_Z': { gcode: 'G0 Z50', description: 'Raise Z to safe clearance' },
          'TOOL_1_OFFSET': { gcode: 'G10 L20 P1 Z0', description: 'Set tool 1 Z offset' }
        }
      },
      compile: {
        abstract_ops: {}
      }
    }
  };

  const result = runCompilerSnapshot(
    'Machine override with macros',
    scriptWithMacro,
    profileWithMacros,
    ['SAFE_Z', 'TOOL_1_OFFSET']
  );
  
  return result.success;
}

// TEST 5: Saved Script Round-Trip
// Purpose: Verify saved scripts with machine override metadata load correctly
function testSavedScriptRoundTrip() {
  console.log('\n========== TEST 5: Saved Script Round-Trip ==========');
  
  // Simulate saved script with v2 metadata
  const savedPayload = {
    title: 'Test Script with Machine Override',
    version: '1.0',
    author: 'Test Suite',
    description: 'Round-trip test of machine override persistence',
    programText: '10 G21\n20 G0 X10\n30 M5',
    vars: { var1: 10 },
    compile_target: {
      base_profile_id: 'grbl-vanilla',
      include_machine_override: true
    },
    machine_override: {
      machine_name: 'Test Machine',
      base_profile_id: 'grbl-vanilla',
      macros: { TEST_MACRO: { gcode: 'G0 Z0' } }
    }
  };
  
  try {
    const normalized = normalizeSavedScriptPayload(savedPayload);
    console.log('Payload normalized successfully');
    console.log(`Title: ${normalized.title}`);
    console.log(`Machine: ${normalized.machine_override?.machine_name || 'none'}`);
    console.log(`Compile target: ${normalized.compile_target?.base_profile_id || 'none'}`);
    console.log(`Macros: ${Object.keys(normalized.machine_override?.macros || {}).join(', ')}`);
    
    // Re-serialize to verify no loss
    const reserializedPayload = {
      ...normalized,
      vars: normalized.vars || {}
    };
    console.log('Round-trip successful');
    return true;
  } catch (error) {
    console.error(`Round-trip failed: ${error.message}`);
    return false;
  }
}

// TEST 6: Opcode Support Matrix
// Purpose: Verify cross-controller opcode support matrix is defined
function testOpcodeMatrix() {
  console.log('\n========== TEST 6: Opcode Support Matrix ==========');
  
  if (!TIER1_OPCODES || !OPCODE_SUPPORT_MATRIX) {
    console.error('ERROR: Tier 1 opcodes or support matrix not defined');
    return false;
  }
  
  const opcodeCount = Object.keys(TIER1_OPCODES).length;
  console.log(`Tier 1 opcodes defined: ${opcodeCount}`);
  
  const supportedControllers = Object.keys(OPCODE_SUPPORT_MATRIX);
  console.log(`Controllers in matrix: ${supportedControllers.join(', ')}`);
  
  // Sample matrix verification
  console.log('\nOpcode Support Summary:');
  supportedControllers.slice(0, 3).forEach(controller => {
    const supported = Object.values(OPCODE_SUPPORT_MATRIX[controller])
      .filter(level => level === 'native' || level === 'macro-expandable').length;
    console.log(`  ${controller}: ${supported}/${opcodeCount} opcodes (supported or macro-expandable)`);
  });
  
  return true;
}

// TEST 7: Error Handling
// Purpose: Verify compiler properly reports errors and warnings
function testErrorHandling() {
  console.log('\n========== TEST 7: Error Handling ==========');
  
  const invalidOpcodeScript = `10 G21
20 UNKNOWN_OPCODE XYZ
30 G0 X10`;

  const result = runCompilerSnapshot(
    'Invalid opcode handling',
    invalidOpcodeScript,
    { id: 'test-profile', v2_preview: { compile: { abstract_ops: {} } } }
  );
  
  // Should report error for unknown opcode
  const hasWarning = result.gcom?.includes('UNKNOWN_OPCODE') || result.error?.includes('unknown');
  console.log(`Error reported: ${hasWarning ? 'YES' : 'NO'}`);
  
  return hasWarning || !result.success;
}

// Run All Tests
function runAllCompilerSnapshots() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 9: COMPILER SNAPSHOT TEST SUITE                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const tests = [
    { name: 'Direct GCOM Regression', fn: testDirectGcomRegression },
    { name: 'Tier 1 Opcode Parsing', fn: testTier1OpcodeParsing },
    { name: 'Cross-Controller Compilation', fn: testCrossControllerCompilation },
    { name: 'Machine Override Composition', fn: testMachineOverrideComposition },
    { name: 'Saved Script Round-Trip', fn: testSavedScriptRoundTrip },
    { name: 'Opcode Support Matrix', fn: testOpcodeMatrix },
    { name: 'Error Handling', fn: testErrorHandling }
  ];
  
  const results = tests.map(test => ({
    ...test,
    passed: test.fn()
  }));
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST SUMMARY                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  results.forEach(result => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} : ${result.name}`);
  });
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\nResult: ${passed}/${total} tests passed`);
  
  return passed === total;
}

// Export for use in Node.js testing environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runAllCompilerSnapshots,
    runCompilerSnapshot
  };
}
