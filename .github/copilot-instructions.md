## Architecture

GCOM is the only user-facing language. No new syntax for users to learn.
Portability across controllers is achieved through a small fixed set of
abstract keywords — HOME, STATUS, RESET, SPINDLE_ON, PROBE — that the
compiler looks up in the active profile's rule_set and lowers to
controller-specific GCOM at compile time. The runtime never sees abstract
keywords.

## Profile format

Two standalone profiles only: grbl-vanilla and fluidnc.
No inheritance, no base profile, no preset composition.
Each profile has exactly four sections:
- machine_description: id, label, axes, capability flags, ack policy,
  connection defaults, ai_guidance, boilerplate_gcom
- rule_set: the five abstract keywords with emit templates, bounds,
  and feature-guard warnings. PROBE may be marked unsupported.
- operations: optional. Named machine-specific templates for motion,
  lifecycle, and tooling. Includes a variables map with typed defaults.
  Must not duplicate rule_set keyword names.
- compiler_strategy: named key selecting internal lowering logic
  (grbl-1.1 or fluidnc)

Schema is enforced via AJV against controller-profiles.schema.json.
Both profiles must validate cleanly in strict mode before any slice
is marked complete.

## Compiler behaviour

- Lines are classified at parse time as: comments/metadata, direct
  line-numbered GCOM, or abstract keyword lines.
- Abstract keyword lines are looked up in the active profile rule_set
  and lowered to concrete GCOM at codegen.
- Direct line-numbered GCOM passes through unchanged regardless of
  active profile.
- A missing rule for any keyword produces an explicit diagnostic and
  fails compilation. A rule marked unsupported produces a warning and
  skips emission but compile succeeds.
- Stage-1 passthrough remains the fallback.
- opcode-ir.js and stage-2 IR lowering are deferred. Do not route
  abstract keyword lowering through them.

## worker.js profile consumption

Profile fields are read from profile.machine_description (not top-level).
A resolved local (profileMachine = profile.machine_description ?? profile)
is used as the fallback pattern. AI context builder includes operations
block when present — operation names, templates, and variable defaults.

## Slice discipline

- Implement one slice at a time.
- Do not change files outside the stated scope for a slice.
- Note follow-up items rather than fixing them immediately.
- Always provide verification results before marking a slice complete.
- Schema validation via AJV strict mode is required for any slice
  that touches profile files.

## Deferred — do not let these shape current implementation

- rules/ folder contents (language, controllers, machines, policies,
  presets) — future direction, not active
- opcode-ir.js stage-2 IR lowering path
- PHASE8-RUNTIME-SHIM.md — superseded
- test-compiler-snapshot.js — references missing functions, needs
  rewriting after compiler stabilises
- gcom-dev SvelteKit scaffold in profiles/ — future profile browser
- Base profile / inheritance / preset composition — revisit when
  profile count makes duplication a real maintenance cost
- worker-api.js — confirm deployment status before syncing with
  worker.js validation logic

## Planned GCOM language extensions (not yet implemented)

Do not implement in current slices but do not design anything that
forecloses them.

- Conditional axis suppression: [X{x}] in templates emits the X word
  and value only when x is non-zero or present. Affects operations
  templates and compiler codegen.
- Built-in read-only variables: {DATE}, {TIME}, {SCRIPT_NAME}
  substituted at execution time. Useful in boilerplate headers.
- Operation call syntax: CALL operation_name(arg1, arg2) expands a
  named operation from the active profile operations block with
  argument substitution. Connects operations to the scripting layer.
- Modal suppression: a machine_description flag for tracking G-code
  modal state and suppressing unchanged words. Compiler behaviour
  change driven by profile, not a language change.
- Tile/repeat abstraction: TILE X={count} OFFSET={step} for grid
  repeat laser marking workflows. Abstract keyword lowered via profile.