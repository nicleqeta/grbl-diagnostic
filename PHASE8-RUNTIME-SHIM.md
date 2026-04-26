# Phase 8: Runtime Shim Budget & Minimal Change Policy

## Overview

This document outlines the strict policy for Phase 8 (Runtime shim budget) regarding modifications to the runtime environment. The principle is: **all compiler output must remain valid GCOM with existing semantics; runtime changes are additive-only and deferred until verification demonstrates concrete limitations.**

## Principles

### 1. Additive, Never Breaking
- All new functionality is opt-in and marked with feature flags or explicit compile modes.
- Existing scripts, profiles, and runtime behavior remain completely unchanged.
- No changes to GCOM syntax, serial protocol, or execution model without explicit version bump.

### 2. Defer Runtime Changes
- Compiler generates standard GCOM whenever possible.
- A narrow runtime shim is permitted only if:
  - ✓ Compiler output would otherwise require brittle duplication or unsafe workarounds.
  - ✓ Feature cannot be expressed portably with existing GCOM.
  - ✓ Verification testing proves concrete limitation in multi-controller scenarios.
- New features must first be validated through compile-time solutions.

### 3. Backward Compatibility Contract
- All saved scripts (v1 and v2_preview) continue to work unchanged.
- Profile selections remain transparent; active profile does not affect script execution.
- Machine overrides never alter existing GCOM emission; they only add optional guidance and metadata.
- AI context and saved metadata are not embedded in GCOM; they are preserved separately for agent use.

## Scope: What IS In-Scope for Phase 8

✓ **Profile metadata in saved scripts** (v2_preview fields in JSON)
  - Non-breaking extension of normalizeSavedScriptPayload
  - Optional fields with safe defaults for old scripts

✓ **Compile-time guidance and diagnostics**
  - Warnings and informational messages about profile unsupported features
  - Comments in generated GCOM marking opcode boundaries
  - Compile envelope reporting stage, diagnostics, and profile used

✓ **Feature flags for future opt-in modes**
  - `compile_mode: 'stage-1-passthrough'` (current, always available)
  - `compile_mode: 'stage-2-opcode-aware'` (future, opt-in)
  - Modes are chosen at compile time; runtime is unaware

✓ **Compile metadata visibility**
  - Preview and run logs show `[grbl-vanilla, stage-1-passthrough]` or similar
  - Confirm dialogs display compile target
  - No change to actual execution semantics

## Scope: What IS NOT In-Scope for Phase 8

✗ **Runtime dispatch** on profile or machine override
  - Runtime must never branch on profile; only GCOM matters to runtime
  - Machine override macros are compile-time constructs; they emit static GCOM

✗ **New GCOM statements or protocol extensions**
  - All output must be standard GCOM; no new line types or syntax
  - If a feature cannot be emitted as standard GCOM, it is deferred

✗ **State tracking of machine models or compile targets**
  - Runtime state machine stays as-is (Idle, Run, Hold, Alarm, etc.)
  - No per-profile state management; profiles are compile-time-only

✗ **Changes to serial protocol or handshake**
  - Ack policy, response patterns, and real-time commands remain profile-specific metadata
  - Runtime uses active profile's ack_policy (already supported by existing code)

✗ **Embedding AI context or private machine docs in GCOM**
  - Saved scripts carry machine_override and compile_target as separate fields
  - AI context is passed to agent at compile request time; not stored in GCOM

## Example: Opcode-to-GCODE Lowering

**Current (Stage-1 Passthrough):**
- Input: High-level opcode script with `HOME`, `MOVE`, `SPINDLE_ON`
- Output: GCOM with opcodes emitted as comments
- Runtime: Treats comments as comments; GCOM executes as-is (no-op for comments)

**Future (If Verification Requires):**
- Stage-2: Replace comment placeholders with actual GCODE via profile rules
- Example: `HOME` → `$H` (GRBL command) or `G28` (some CAM postprocessors)
- Runtime: Receives standard GCOM; no awareness of opcode origin

## Example: Machine Override Macros

**Compile Time:**
- Macros are resolved and inlined into GCOM during compilation
- Example: Script says `SAFE_Z`; profile defines `SAFE_Z` → `G0 Z50`
- Compiler emits `100 G0 Z50` (or appends to next line)

**Runtime:**
- Receives standard GCOM line `100 G0 Z50`
- No awareness that it originated from a macro
- Executes identically to hand-written GCOM

## Decision Gate for Runtime Changes

Before any runtime shim is implemented:

1. ✓ **Problem Documented**: Concrete failure case (e.g., "cross-controller X requires dynamic probe timeout adjustment")
2. ✓ **Compile-Time Solution Attempted**: Try to solve via profile rules, IR nodes, or GCOM generation
3. ✓ **Verification Test**: Cross-controller regression tests prove the limitation is real
4. ✓ **Design Review**: Proposed shim is minimal, additive, and backward-compatible
5. ✓ **Implementation**: Change is guarded by feature flag; can be disabled for testing

## Test Coverage for Phase 8

- Existing direct GCOM runs unchanged (regression test)
- Profile selection does not affect GCOM execution
- Saved scripts with v2_preview metadata load and compile without error
- Machine override metadata round-trips without data loss
- Compile envelope and diagnostics are visible but do not affect runtime

## Rollout Phase (Before Phase 9 Production)

1. All tests in test-compiler-snapshot.js pass
2. Manual verification on at least 2 controllers (GRBL 1.1h, FluidNC)
3. Verify existing saved scripts load and run unchanged
4. Deploy behind feature flag: `enable_high_level_mode = false` (default)
5. Public beta: Users opt-in to feature flag and report issues
6. GA: Enable by default once threshold of acceptance tests pass

## Summary

**Phase 8 is about establishing boundaries, not implementing runtime logic.** The architectural foundation (Phases 1-7) is complete:

- ✓ Profiles extended (v1 + v2_preview)
- ✓ Compiler pipeline built (parse → IR → codegen)
- ✓ Opcodes defined (17 Tier 1 + matrix)
- ✓ Machine overrides supported (macros, tools, parking)
- ✓ Saved scripts persist metadata (round-trip works)
- ✓ Tests verify cross-controller portability

Runtime stays simple: execute GCOM, report results. Complexity lives in compilation. If runtime limitations arise, they will surface in Phase 9 verification, and any shim will be minimal, guarded, and deferred until proven necessary.
