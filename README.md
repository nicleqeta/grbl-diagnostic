# gcomposer / GRBL console

A browser-based GRBL console with a built-in scripting engine. Write scripts that send commands, wait for responses, loop, branch, and do math. Preview motion before connecting to hardware. Open it in Chrome or Edge, click Connect, and use USB / Serial or WebSocket with no install required.

Live at https://gcomposer.app

---

## Vision

gcomposer started as a browser-based GRBL serial console and diagnostic tool. Its long-term direction is to become a **programmable CNC automation and diagnostics layer** that works alongside existing tools.

The goal is not to replace established CAM or control software, but to complement them by providing:

* a scriptable environment for repeatable machine tests and workflows
* a shareable, URL-based system for diagnostics and support
* a structured execution layer that bridges human intent and machine motion
* a foundation for higher-level tooling, including AI-assisted script generation and analysis

Over time, gcomposer is evolving toward a model with:

* a high-level, intent-focused scripting format
* an intermediate representation (IR) of machine operations
* a compiler layer targeting specific controller flavors such as GRBL

This enables more portable, explainable, and verifiable CNC workflows while preserving the reliability and transparency of the current system.

---

## What This App Does

gcomposer connects to a GRBL controller from the browser over USB / Serial or WebSocket.

It can help you:

* connect to a GRBL device from the browser over USB / Serial or WebSocket
* see exactly what the controller sends back
* send simple GRBL commands like `?`, `$$`, `$I`, and `$X`
* write automated scripts that send commands, wait for responses, loop, branch, and do math
* preview motion sequences before connecting to hardware
* test different startup and DTR behaviors
* copy a structured diagnostics log for support or forum posts
* save and share scripts via short links

---

## Why This Is Useful

When a GRBL program has trouble connecting to a machine, it is often not clear exactly what the problem is.

gcomposer makes this visible and repeatable.

A support person can send a web link with a preloaded routine that:

* attempts to connect
* runs diagnostic steps
* captures structured logs

That output can be pasted directly into a forum or support thread.

The scripting system also enables:

* calibration routines
* motion experiments
* repeatable machine tests
* programmable workflows

Because scripts are shareable via URL, they work well in documentation, forums, and remote troubleshooting.

---

## Basic Use

1. Open the page in Chrome or Edge
2. An incognito or InPrivate window is recommended for the cleanest run
3. Click Connect
4. For USB / Serial, plug in the GRBL controller, choose the baud rate, and select the serial port
5. For WebSocket, enter the controller address and port
6. Watch the terminal output
7. Use quick commands, run scripts, or ask the AI Agent to help create a GCOM program

Common quick commands:

* `?` → status
* `$X` → clear alarm lock
* `$$` → show settings
* `$I` → build info
* `^X` → soft reset

---

## Simple Troubleshooting Steps

If the controller does not respond:

1. Connect to the device
2. Wait a few seconds
3. Look for a startup line like `Grbl 1.1h`
4. Send `?`
5. If alarmed, try `$X`
6. If behavior is unclear, run diagnostics

---

## Advanced Diagnostics

### Observe Only

Open the port without sending startup commands.

Useful for checking:

* reset behavior
* delayed startup messages
* spontaneous output

---

### DTR Tests

Test different DTR modes:

* default
* forced low
* forced high
* pulsed

Useful for diagnosing connection inconsistencies.

---

### Shareable Presets

Load test routines directly from a URL.

---

### Copy Log

Copy a structured diagnostics report for:

* forum posts
* bug reports
* comparisons

---

## Good Uses For This Tool

* GRBL sender connects but stays Busy
* no response after connect
* board resets unexpectedly
* inconsistent behavior across apps
* DTR-related issues
* need clean logs for support

---

## What To Look For In The Log

Helpful:

* startup line
* response to `?`
* `<Idle>` or `<Alarm>`
* `ok` responses

Warning signs:

* no startup text
* repeated resets
* no response
* garbled output

---

## Browser Support

Supported:

* Chrome
* Edge

Not supported:

* Safari
* Firefox

---

## Mac Support

Works on macOS with Chrome or Edge if:

* the device appears as a serial port
* required USB drivers are installed

---

## Limits

* Browser serial behavior differs from native apps
* Not a full replacement for CNC control software
* Best used for diagnostics, scripting, and comparison

---

## Typical Workflow

1. Run a connection test
2. Run diagnostics if needed
3. Compare DTR modes
4. Copy the log
5. Share results

---

## GCOM Scripting

### About GCOM

GCOM is a line-numbered scripting language designed for reliable, step-by-step interaction with GRBL over a serial connection.

It provides precise control over:

* command sequencing
* timing
* response handling

GCOM can be thought of as the **execution layer of gcomposer** — a deterministic runtime that sends commands, waits for responses, and manages control flow.

Future versions of gcomposer may introduce higher-level scripting formats that compile down to GCOM, allowing users to work at a more abstract level while preserving reliability and transparency.

---

### Example Script

```
10 LET feedrate = 1000
20 SEND "G28" REQUIRE_OK
30 WAIT_IDLE 15000
40 PRINT "Homing complete"
50 FOR i = 1 TO 5
60   SEND "G1 X" & STR(i * 10) & " F" & STR(feedrate) REQUIRE_OK
70 NEXT i
80 END
```

---

### Key Features

* variables and math
* loops and branching
* wait controls (`WAIT`, `WAIT_IDLE`, `WAIT_STATE`) and ack-gated sends (`REQUIRE_OK`)
* serial input handling
* user prompts
* deterministic execution

### String And Token Helpers

GCOM includes lightweight string helpers for runtime parsing and safer comparisons:

* text normalization: `TRIM`, `UPPER`, `LOWER`, `LEN`
* matching: `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`
* extraction: `SUBSTR`, `REPLACE`
* tokenization: `SPLIT_COUNT`, `SPLIT_PART`, `SPLIT_INTO`

`SPLIT_INTO(text, delim, prefix)` writes tokens into variables:

* `prefix_COUNT`
* `prefix_1 ... prefix_N`

Example:

```
10 LET status = "<Idle|MPos:10.000,20.500,-1.250|FS:0,0>"
20 LET n = SPLIT_INTO(status, "|", "tok")
30 IF n >= 2 THEN LET pos = SPLIT_PART(tok_2, ":", 2, "0,0,0")
40 LET x = SPLIT_PART(pos, ",", 1, "0")
50 PRINT "X=" & x & " Mode=" & TRIM(REPLACE(tok_1, "<", ""))
60 END
```

---

### Execution Model

* asynchronous in browser
* instruction limit: 1,000,000
* timeout: 10 hours
* pause/resume supported
* preview mode available

---

## Preview Mode

Dry-run scripts without hardware.

Shows:

* SEND events
* WAIT events
* PRINT output

Useful for validating logic before running on a machine.

---

## Share URL System

Scripts are saved and shared via short IDs:

```
https://gcomposer.app/?gcom=abc123
```

Variable overrides:

```
https://gcomposer.app/?gcom=abc123&feedrate=2000
```

---

## Integration and External Use

gcomposer is designed to work alongside existing CNC and laser software rather than replace it.

Potential integration points include:

* launching predefined diagnostic routines via URL
* analyzing or replaying G-code generated by other tools
* providing a standardized environment for GRBL troubleshooting
* acting as an advanced scripting layer for power users

Because it runs in the browser with no installation required, it can be easily linked from:

* documentation
* support forums
* external applications

Future versions may expose APIs or embeddable components for deeper integration.

---

## Future Directions

Areas under active exploration include:

* higher-level, intent-based scripting built on top of GCOM
* intermediate representations (IR) for machine operations
* machine-aware compilation for different controller flavors
* improved motion preview using structured data
* AI-assisted script generation, explanation, and validation
* safety analysis and motion verification

These features will evolve over time as the project develops.

---

## Summary

gcomposer is a browser-based GRBL serial console with a built-in scripting engine.

It combines:

* low-level serial diagnostics
* programmable automation
* shareable workflows

with a forward path toward structured, higher-level CNC scripting and analysis.

No install required. Runs in Chrome and Edge via Web Serial.
