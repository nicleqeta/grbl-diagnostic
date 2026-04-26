// Phase 3 & 4: Tier 1 Opcode Registry and IR Definitions
// Portable abstract machine operations mapped to controller-specific GCode/commands
// via profile lowering rules. This module defines the compilation target model.

const TIER1_OPCODES = {
  HOME: {
    id: 'HOME',
    label: 'Home Axes',
    category: 'motion',
    semantics: 'Move all specified axes to home position (machine origin); blocks until idle.',
    args: { axes: 'string (XYZ subset, e.g. "XY")' },
    requires: { homed: false },
    ensures: { homed: true }
  },
  MOVE: {
    id: 'MOVE',
    label: 'Linear Motion',
    category: 'motion',
    semantics: 'Rapid or feed motion to target position; uses active modal settings.',
    args: { targets: 'object {X, Y, Z, ...}', rapid: 'boolean', feedrate: 'number' },
    requires: { homed: false },
    ensures: {}
  },
  DWELL: {
    id: 'DWELL',
    label: 'Timed Wait',
    category: 'control',
    semantics: 'Pause motion for specified duration; spindle continues.',
    args: { duration_ms: 'number' },
    requires: {},
    ensures: {}
  },
  PROBE: {
    id: 'PROBE',
    label: 'Probing Cycle',
    category: 'motion',
    semantics: 'Move toward target until probe triggers; record position.',
    args: { targets: 'object', probeMode: 'string' },
    requires: { probeToolMounted: true },
    ensures: { probePositionRecorded: true }
  },
  SET_OFFSET: {
    id: 'SET_OFFSET',
    label: 'Set Work Offset',
    category: 'machine-state',
    semantics: 'Set work offset (G10 equivalent); captures current machine position as WCS reference.',
    args: { wcsNumber: 'number (1-6 for G54-G59)', axes: 'object' },
    requires: { homed: true },
    ensures: {}
  },
  USE_WCS: {
    id: 'USE_WCS',
    label: 'Select Work Offset',
    category: 'machine-state',
    semantics: 'Activate a work offset (G54-G59).',
    args: { wcsNumber: 'number (1-6)' },
    requires: {},
    ensures: {}
  },
  SPINDLE_ON: {
    id: 'SPINDLE_ON',
    label: 'Start Spindle',
    category: 'io-control',
    semantics: 'Start spindle at specified speed and direction.',
    args: { speed: 'number (RPM)', direction: 'string (CW|CCW)' },
    requires: {},
    ensures: { spindleRunning: true }
  },
  SPINDLE_OFF: {
    id: 'SPINDLE_OFF',
    label: 'Stop Spindle',
    category: 'io-control',
    semantics: 'Stop spindle rotation.',
    args: {},
    requires: {},
    ensures: { spindleRunning: false }
  },
  COOLANT: {
    id: 'COOLANT',
    label: 'Control Coolant',
    category: 'io-control',
    semantics: 'Control coolant flow (flood/mist).',
    args: { mode: 'string (OFF|FLOOD|MIST|BOTH)' },
    requires: {},
    ensures: {}
  },
  TOOL_PREP: {
    id: 'TOOL_PREP',
    label: 'Prepare Tool',
    category: 'io-control',
    semantics: 'Select tool; does not move spindle. T-code equivalent.',
    args: { toolNumber: 'number' },
    requires: {},
    ensures: { toolSelected: true }
  },
  TOOL_CHANGE: {
    id: 'TOOL_CHANGE',
    label: 'Perform Tool Change',
    category: 'io-control',
    semantics: 'Execute full tool-change procedure; optional automatic spindle position.',
    args: { toolNumber: 'number', safeHeight: 'number or null' },
    requires: { toolSelected: true },
    ensures: { toolMounted: true }
  },
  PARK: {
    id: 'PARK',
    label: 'Park Machine',
    category: 'motion',
    semantics: 'Move to a safe parking position; often end-of-job standard.',
    args: { safeZ: 'number' },
    requires: {},
    ensures: {}
  },
  CLEAR_ALARM: {
    id: 'CLEAR_ALARM',
    label: 'Clear Alarm',
    category: 'control',
    semantics: 'Clear alarm condition; machine must be recoverable.',
    args: {},
    requires: {},
    ensures: { alarmCleared: true }
  },
  RESET: {
    id: 'RESET',
    label: 'Soft Reset',
    category: 'control',
    semantics: 'Soft reset: abort motion, clear buffer, enter safe state.',
    args: {},
    requires: {},
    ensures: { resetApplied: true }
  },
  STATUS: {
    id: 'STATUS',
    label: 'Query Status',
    category: 'diagnostics',
    semantics: 'Request machine status report (realtime).',
    args: {},
    requires: {},
    ensures: { statusReported: true }
  },
  OUTPUT: {
    id: 'OUTPUT',
    label: 'Digital/Analog Output',
    category: 'io-control',
    semantics: 'Set digital or analog output.',
    args: { port: 'number', value: 'number or boolean' },
    requires: {},
    ensures: {}
  },
  WAIT_STATE: {
    id: 'WAIT_STATE',
    label: 'Wait for Machine State',
    category: 'control',
    semantics: 'Block until machine reaches target state (Idle, Hold, etc).',
    args: { state: 'string (Idle|Run|Hold|...)', timeout_ms: 'number' },
    requires: {},
    ensures: {}
  }
};

// IR Node Definitions: Compiler-internal representation of abstract intent
const IR_NODE_TYPES = {
  MOTION: 'motion',
  STATE_CHANGE: 'state_change',
  SETUP: 'setup',
  TOOL_EVENT: 'tool_event',
  PROBE_EVENT: 'probe_event',
  IO_EVENT: 'io_event',
  CONTROL_FLOW: 'control_flow',
  DIAGNOSTICS: 'diagnostics'
};

function createIRNode(type, sourceLineNum = 0, payload = {}) {
  return {
    type,
    sourceLineNum,
    payload,
    annotations: {
      requiresHomed: false,
      requiresToolMounted: false,
      requiresFeed: false,
      profileExtensionUsed: false,
      portabilityWarning: null,
      degradedFallback: false
    }
  };
}

// Opcode-to-GCOM Mapping: Stage-1 pass-through; later stages resolve profile-specific rules
function getOpcodeMapping(opcodeId, profile = null) {
  const profileId = profile && typeof profile.id === 'string' ? profile.id : null;
  const mappings = {
    HOME: { gcode: '$H', wait: 'idle' },
    MOVE: { gcode: 'G0/G1 (X Y Z F S)', wait: 'none' },
    DWELL: { gcode: 'G4 P', wait: 'none' },
    SPINDLE_ON: { gcode: 'M3/M4 S', wait: 'none' },
    SPINDLE_OFF: { gcode: 'M5', wait: 'none' },
    RESET: { gcode: '^X (realtime)', wait: 'none' },
    PARK: { gcode: 'G0 Z{safeZ} (profile-defined)', wait: 'idle' },
    TOOL_PREP: { gcode: 'T N', wait: 'none' },
    TOOL_CHANGE: { gcode: 'M6 (profile-defined)', wait: 'idle' },
    STATUS: { gcode: '? (realtime)', wait: 'none' },
    CLEAR_ALARM: { gcode: '$X', wait: 'idle' },
    PROBE: { gcode: 'G38.2/G38.3 (X Y Z F)', wait: 'idle' }
  };
  return mappings[opcodeId] || { gcode: `[opcode ${opcodeId} not yet mapped]`, wait: 'none' };
}

// Cross-controller abstraction matrix: opcode support levels
const OPCODE_SUPPORT_MATRIX = {
  GRBL: {
    HOME: 'native',
    MOVE: 'native',
    DWELL: 'native',
    PROBE: 'native',
    SET_OFFSET: 'native',
    USE_WCS: 'native',
    SPINDLE_ON: 'native',
    SPINDLE_OFF: 'native',
    COOLANT: 'macro-expandable',
    TOOL_PREP: 'native',
    TOOL_CHANGE: 'macro-expandable',
    PARK: 'macro-expandable',
    CLEAR_ALARM: 'native',
    RESET: 'native',
    STATUS: 'native',
    OUTPUT: 'unsupported',
    WAIT_STATE: 'partially-supported'
  },
  FluidNC: {
    HOME: 'native',
    MOVE: 'native',
    DWELL: 'native',
    PROBE: 'native',
    SET_OFFSET: 'native',
    USE_WCS: 'native',
    SPINDLE_ON: 'native',
    SPINDLE_OFF: 'native',
    COOLANT: 'native',
    TOOL_PREP: 'native',
    TOOL_CHANGE: 'macro-expandable',
    PARK: 'macro-expandable',
    CLEAR_ALARM: 'native',
    RESET: 'native',
    STATUS: 'native',
    OUTPUT: 'native',
    WAIT_STATE: 'native'
  },
  grblHAL: {
    HOME: 'native',
    MOVE: 'native',
    DWELL: 'native',
    PROBE: 'native',
    SET_OFFSET: 'native',
    USE_WCS: 'native',
    SPINDLE_ON: 'native',
    SPINDLE_OFF: 'native',
    COOLANT: 'native',
    TOOL_PREP: 'native',
    TOOL_CHANGE: 'macro-expandable',
    PARK: 'macro-expandable',
    CLEAR_ALARM: 'native',
    RESET: 'native',
    STATUS: 'native',
    OUTPUT: 'native',
    WAIT_STATE: 'native'
  },
  LinuxCNC: {
    HOME: 'native',
    MOVE: 'native',
    DWELL: 'native',
    PROBE: 'native',
    SET_OFFSET: 'native',
    USE_WCS: 'native',
    SPINDLE_ON: 'native',
    SPINDLE_OFF: 'native',
    COOLANT: 'native',
    TOOL_PREP: 'native',
    TOOL_CHANGE: 'native',
    PARK: 'native',
    CLEAR_ALARM: 'native',
    RESET: 'native',
    STATUS: 'native',
    OUTPUT: 'native',
    WAIT_STATE: 'native'
  }
};

function emitCompileMetadata(source, profile, ir = null) {
  return {
    success: true,
    gcom: source,
    ir: ir || [],
    diagnostics: [],
    compiler: {
      stage: 'stage-1-passthrough',
      profile_id: profile && typeof profile.id === 'string' ? profile.id : null,
      tier1_opcodes_supported: Object.keys(TIER1_OPCODES).length,
      ir_nodes_generated: (ir || []).length
    }
  };
}
