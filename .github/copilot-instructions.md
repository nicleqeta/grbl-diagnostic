## Architecture

GCOM is the only user-facing language. No new syntax for users to learn.
Portability across controllers is achieved through a small fixed set of
abstract keywords — HOME, STATUS, RESET, SPINDLE_ON, PROBE — that the
compiler looks up in the active profile's rule_set and lowers to
controller-specific GCOM at compile time. The runtime never sees abstract
keywords.

Abstract keywords (HOME, STATUS, RESET, SPINDLE_ON, PROBE) are
compiler-only concepts. They must never appear in AI prompt instructions
as things the AI should write. The AI writes plain GCOM only.

## Profile format

Two standalone profiles only: grbl-vanilla and fluidnc.
No inheritance, no base profile, no preset composition.
Each profile has exactly four sections:
- machine_description: id, label, axes, capability flags, ack policy,
  connection defaults, ai_guidance, boilerplate_gcom
- rule_set: the five abstract keywords with emit templates, bounds,
  and feature-guard warnings. PROBE may be marked unsupported.
- operations: compiler and schema reference only. Not injected into
  the AI prompt. The AI receives plain GCOM examples via user machine
  profiles instead. Named machine-specific templates for motion,
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
is used as the fallback pattern. AI context builder does NOT inject the
operations block or rule_set keywords into the AI prompt. The AI receives
plain GCOM examples via user machine profiles instead.

## AI prompt contract

The AI must only ever be shown and told to write plain runnable GCOM.
Never inject abstract keyword names (HOME, SPINDLE_ON etc.) or operation
names (cut_move, tool_off etc.) into the AI prompt as callable statements.

When a profileRef is present in composerContext:
- Fetch the user machine profile from KV (key: profile:{id})
- Inject: machine name and notes, base controller label, numbered
  command list showing name and plain GCOM line, snippets as named
  GCOM reference, default presets
- Prefix with: "You are writing GCOM for a {meta.name} running
  {base_controller}. Use these exact GCOM lines for common operations:"

When no profileRef is present:
- Inject only: controller flavor label, ai_guidance summary,
  preferred_style, avoid list, and boilerplate_gcom as recommended
  starting structure
- Do not mention abstract keywords or operation names
- The AI falls back to plain GCOM based on GCOM_SYSTEM rules and
  flavor guidance only

Keep in all cases: ack_policy, boilerplate_gcom, ai_guidance
preferred_style and avoid lists.

## User machine profiles

User machine profiles are stored in KV under key profile:{id}.
Schema defined in profiles/user-machine-profile.schema.json.
A profile contains: meta, base_controller, commands (plain GCOM
examples with name, description, gcom line, and example), snippets
(named reusable GCOM blocks), and presets (default_feed, default_power,
rapid_feed).

Commands should cover lifecycle hooks by name where present:
- job_start: full preamble sequence for this machine
- job_end: full postamble sequence for this machine
- tool_on_sequence: laser/spindle on with power
- tool_off_sequence: laser/spindle off
- home: homing sequence
- rapid_move: positioning move
- cut_move: cutting/marking move with feed rate

These hook names are not enforced — they are conventions the AI
recognises when structuring a complete job script. The schema places
no enum constraint on commands[].name. Lifecycle hook name suggestions
are surfaced in the profiler UI via a datalist, not enforced by schema.

Endpoints:
- POST /api/profiles — stores profile, returns { id, url }
- GET /api/profiles/:id — returns profile JSON or 404

When a profileRef is present in composerContext, the AI contract
injects the profile's command list as plain GCOM examples.
When no profileRef is present, the AI receives only controller
flavor guidance and boilerplate — no abstract keywords, no operation
names.

Scripts may contain ;PROFILE: abc123 as a metadata header line,
recognised by the compiler as metadata only (not compiled). The
compiler surfaces it in metadata.profile_id_hint. The worker reads
it and uses it as profileRef for AI generation.

## Profiler UI

The profiler lives at /profiler as a standalone plain HTML page.
It is a separate tool from the main app, not part of the core
scripting experience.

CRITICAL: The profiler must never open in the same window as the
main app. All links and buttons in index.html that open the profiler
must use target="_blank" and rel="noopener". The main app window
must never navigate away from itself under any circumstance —
it behaves as a persistent installed application.

The main app should feel like a PWA. A Web App Manifest
(manifest.json) with appropriate icons and display mode "standalone"
should be added to index.html so the app can be installed to desktop
or taskbar and opens without browser chrome.

A beforeunload warning should fire in index.html if there is an
active serial connection or a running script, to prevent accidental
disconnection or loss of work.

The profiler page (profiler.html) features:
- Base controller selector (grbl-vanilla / fluidnc)
- Machine meta form: name, firmware, bed size, tool, notes
- Commands list: name | description | GCOM line | edit/delete
  - "Add Command" uses a datalist suggesting lifecycle hook names
  - Free entry, not constrained to the suggestions
- Snippets tab and Presets tab
- Live preview panel: boilerplate_gcom with machine context
- Rosetta comparison panel: same hook name side-by-side for
  grbl-vanilla vs fluidnc (display only, not injected into AI)
- Save flow: POST /api/profiles → show share URL + copyable
  ;PROFILE: abc123 header line
- Load by ID input → GET /api/profiles/:id → populate form
- localStorage draft auto-save on every change
- "Back to app" link opens main app in a new tab (never replaces
  the profiler tab either)

The main app (index.html) machine profile control:
- A small control near the controller profile selector showing
  current machine context: [Default ▼ ✎] or [Machine name ▼ ✎]
- Dropdown has three items:
  - View defaults: read-only overlay of current controller flavor
    ai_guidance, boilerplate_gcom, and default command patterns
  - Create machine profile: opens /profiler in a new tab,
    pre-populated via URL param ?base=grbl-vanilla (or active flavor)
  - Load profile by ID: text input, fetches GET /api/profiles/:id,
    shows profile meta.name as confirmation before applying
- The ✎ icon: opens /profiler?id={activeId} in a new tab if a
  profile is loaded, or /profiler?base={flavor} if on defaults
- All profiler links must use window.open with target _blank —
  never navigate the main app window

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
- test-compiler-snapshot.js — references missing functions, needs
  rewriting after compiler stabilises
- gcom-dev SvelteKit scaffold in profiles/ — future profile browser
- Base profile / inheritance / preset composition — revisit when
  profile count makes duplication a real maintenance cost

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

- Subroutine syntax: DEF proc_name ... END DEF and CALL proc_name(args)
  for user-defined reusable sub-programs within a script. Distinct from
  operation call syntax which expands profile templates. Enables complex
  patterns and spiral/grid generation without flat script repetition.
  Inspired by FANUC postprocessor @proc / @end_proc / @call_proc pattern.

- Modal suppression: a machine_description flag for tracking G-code
  modal state and suppressing unchanged words. Compiler behaviour
  change driven by profile, not a language change. Inspired by FANUC
  postprocessor change(gcode) pattern.

- Tile/repeat abstraction: TILE X={count} OFFSET={step} for grid
  repeat laser marking workflows. Abstract keyword lowered via profile.

- Lifecycle hooks: formal preamble and postamble sequence declarations
  in user machine profiles — job_start, job_end, tool_on_sequence,
  tool_off_sequence — that the AI knows to reference when structuring
  a complete job script. Partially addressed by profile commands array
  convention but may need explicit compiler or runtime support later.

- Arc parameter guidance: when to use IJK center form vs R radius form
  for G2/G3. IJK required for full 360-degree arcs, R acceptable for
  partial arcs under 180 degrees. Should be reflected in ai_guidance
  in the controller profile and in GCOM_SYSTEM prompt guidance.

- Numeric variable persistence: mechanism for variables to persist
  across script sections or be passed into sub-programs. GCOM LET
  variables are currently local and flat. Inspired by FANUC #N register
  pattern used for repeat counts and origin offsets.