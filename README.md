# gcomposer / GRBL serial console

A browser-based GRBL serial console with a built-in scripting engine. Write scripts that send commands, wait for responses, loop, branch, and do math. Preview motion before connecting to hardware. Runs in Chrome and Edge via Web Serial — no install required.

Live at [gcomposer.app](https://gcomposer.app).

## What This App Does

gcomposer opens a serial connection to a GRBL controller using the browser's Web Serial feature.

It can help you:

- connect to a GRBL device from the browser
- see exactly what the controller sends back
- send simple GRBL commands like `?`, `$$`, `$I`, and `$X`
- write automated scripts that send commands, wait for responses, loop, branch, and do math
- preview motion sequences before connecting to hardware
- test different startup and DTR behaviors
- copy a structured diagnostics log for support or forum posts
- save and share scripts via short links

## Why This Is Useful

When a CNC program like MillMage has trouble connecting, it is often not clear whether the problem is:

- the app
- the USB serial connection
- the GRBL board
- reset timing on connect
- DTR behavior
- firmware startup timing
- alarm state or controller state

The serial console and diagnostics tools help separate those problems by showing the raw serial behavior directly.

The GCOM scripting engine goes further — it lets you write repeatable test routines, tune machine settings, run motion benchmarks, and share those scripts with others via a URL.

## Basic Use

1. Open the page in Chrome or Edge.
2. Plug in the GRBL controller over USB.
3. Choose the correct baud rate.
4. Click Connect.
5. Select the serial port for the controller.
6. Watch the terminal output.
7. Use the quick commands if needed.

Common quick commands:

- `?` asks for status
- `$X` clears alarm lock
- `$$` shows settings
- `$I` shows build info
- `^X` sends a soft reset

## Simple Troubleshooting Steps

If the controller does not seem to respond:

1. Connect to the device.
2. Wait a few seconds.
3. Look for a GRBL startup line such as `Grbl 1.1h`.
4. Send `?` to request status.
5. If the machine is alarmed, try `$X`.
6. If the log shows strange timing or no response, try Advanced Diagnostics.

## Advanced Diagnostics

The app includes extra tools for harder connection problems.

### Observe Only

Use Observe Only when you want to open the port and watch what the board does without sending the usual startup traffic.

This is useful for checking whether:

- the board resets on connect
- a delayed startup banner appears
- the device is sending readable output by itself

### DTR Tests

Some boards, especially Nano-based or clone boards, react differently depending on DTR.

The app can test:

- default DTR behavior
- forced DTR low
- forced DTR high
- pulsed DTR

This helps compare whether the controller behaves better with one mode than another.

### Shareable Presets

The app can load test settings from the URL.

That makes it easier to send a user one exact test to run and compare results.

### Copy Log

Use Copy log to copy a structured diagnostics report.

This is useful for:

- forum posts
- bug reports
- comparing multiple tests
- sharing exact results with support

## Good Uses For This Tool

This app is especially useful when:

- The GRBL sender connects but stays Busy
- GRBL does not answer right after connecting
- the board seems to reset when a program opens the port
- the controller works in one app but not another
- you need to compare DTR on vs off behavior
- you need a clean log for support

## What To Look For In The Log

Helpful signs:

- a readable GRBL startup line
- a response to `?`
- status lines like `<Idle...>` or `<Alarm...>`
- `ok` after normal commands
- `error:` or `ALARM:` lines that explain a problem

Possible warning signs:

- no readable startup text
- delayed startup banner
- repeated startup banner after one connect
- no response to `?`
- read fault or write fault
- garbled output

## Browser Support

This app uses Web Serial.

Supported browsers:

- Chrome
- Edge

Not supported:

- Safari
- Firefox

## Will This Work On A Mac?

Yes, usually.

This app can work on a Mac as long as:

- you use Chrome or Edge on macOS
- the GRBL board appears as a serial device
- any required USB serial driver is installed

Notes for Mac users:

- Safari does not support Web Serial for this app
- some GRBL boards use CH340 or CP2102 USB serial chips
- those may need the correct macOS driver, depending on the board and macOS version
- if no serial port appears, the issue may be the USB cable, adapter, or driver rather than the app

## Limits

This tool is very useful for diagnosis, but it does not perfectly replicate every native CNC application.

For example:

- a native app may handle port opening differently
- DTR timing may not exactly match another app
- browser serial behavior is not identical to desktop app serial behavior

So this app is best used to diagnose and compare behavior, not to prove with absolute certainty how another app works internally.

## Typical Support Workflow

1. Run a normal connect test.
2. If needed, run an observe-only test.
3. If needed, compare DTR modes.
4. Copy the log.
5. Share the results in a forum or support thread.

## Summary

gcomposer is a browser-based GRBL serial console with a built-in scripting engine. It covers everything from raw serial diagnostics — checking startup banners, DTR behavior, and connection timing — to writing automated motion scripts, tuning machine settings, and sharing repeatable test routines via short links.

No install required. Runs in Chrome and Edge via Web Serial.

---

## GCOM Scripting

The app includes a full line-numbered GCOM script interpreter for writing automated GRBL test and motion scripts.

Scripts run in the browser, send serial commands to the GRBL controller, wait for responses, and can loop, branch, do math, and prompt the user for input.

### Writing a Script

Scripts use line numbers. Each line starts with a number followed by a statement.

```
10 LET feedrate = 1000
20 SEND "G28" WAIT FOR IDLE
30 PRINT "Homing complete"
40 FOR i = 1 TO 5
50   SEND "G1 X" & STR(i * 10) & " F" & STR(feedrate) WAIT FOR OK
60 NEXT i
70 END
```

Line numbers can be any positive integer. Lines execute in ascending order. Use GOTO to jump.

### Statements

| Statement | Description |
|-----------|-------------|
| `LET var = expr` | Assign a value to a variable |
| `SEND expr` | Send a GRBL command string over serial |
| `SEND expr WAIT FOR OK` | Send and wait for an `ok` response |
| `SEND expr WAIT FOR IDLE` | Send and wait until GRBL status is `Idle` |
| `SEND expr WAIT FOR GRBL` | Send and wait for a GRBL startup banner |
| `WAIT ms` | Pause execution for N milliseconds |
| `WAIT FOR OK` | Wait for an `ok` response without sending |
| `WAIT FOR IDLE` | Wait until GRBL status is `Idle` |
| `WAIT FOR GRBL` | Wait for a GRBL startup banner |
| `PRINT expr` | Print a message to the terminal log |
| `INPUT var` | Prompt the user for a value |
| `LET var = INPUT(prompt)` | Prompt the user inline with a label |
| `READ var` | Read the next incoming serial line |
| `IF cond THEN GOTO line` | Conditional jump to a line number |
| `GOTO line` | Unconditional jump to a line number |
| `FOR var = start TO end` | Begin a counting loop (optional `STEP n`) |
| `NEXT var` | End of FOR loop body |
| `END` | Terminate the script |
| `RESULT expr` | Return a final value from the script |

### Built-In Functions

| Function | Description |
|----------|-------------|
| `INPUT(prompt)` | Prompt the user (returns a number or string) |
| `READ(timeout)` | Read the next serial line (timeout in ms) |
| `SETTING(n)` | Read GRBL setting `$n` as a number |
| `STATE()` | Current GRBL state: `Idle`, `Run`, `Alarm`, `Hold`, etc. |
| `STR(n)` | Convert a number to a string |
| `INT(n)` | Truncate to integer |
| `ABS(n)` | Absolute value |
| `RND(n)` | Random number in [0, n) |
| `SIN(deg)` | Sine, argument in degrees |
| `COS(deg)` | Cosine, argument in degrees |
| `TAN(deg)` | Tangent, argument in degrees |
| `ASIN(x)` | Arc sine, result in degrees |
| `ACOS(x)` | Arc cosine, result in degrees |
| `ATAN(x)` | Arc tangent, result in degrees |
| `ATAN2(y, x)` | Two-argument arc tangent, result in degrees |
| `SQRT(x)` | Square root |
| `ROUND(x)` | Round to nearest integer |
| `RAD(deg)` | Degrees to radians |
| `DEG(rad)` | Radians to degrees |
| `PI` | The constant π (3.14159…) |

### Expressions

- Arithmetic: `+` `-` `*` `/` `^` (power)
- String concatenation: `&`
- Comparison: `=` `<` `>` `<>` `<=` `>=`
- Parentheses for grouping
- Variable names are case-insensitive

### Variable Template System

Scripts can declare default parameter values at the top using `{name}` placeholders.

```
{feedrate=1000}
{passes=3}
```

These are substituted before execution. Users can override them:

- In the Variables panel in the UI before running
- Via URL: `?vars=feedrate=2000,passes=5`

Special metadata fields: `{title}`, `{author}`, `{version}`, `{description}`

### Importing Plain GCOM Script Files

The GCOM script editor can import local plain-text script files.

For richer imports, add a short header before the first numbered GCOM script line:

```text
REM TITLE: X-Axis Max travel Speed and Acceleration Finder
REM VERSION: 1
REM AUTHOR: GitHub Copilot
REM DESCRIPTION: Raises X acceleration while sweeping fast X travel moves to find the highest reliable travel speed.
REM DESCRIPTION: Suggests a conservative fallback near the edge and reports estimated midpoint travel speed.
REM VAR start_accel=200
REM VAR coarse_step=50
10 PRINT "X-axis acceleration test"
```

Rules:

- Only top-of-file `REM` header lines are treated as import metadata.
- Repeated `REM DESCRIPTION:` lines become a multiline description.
- `REM VAR name=value` defines imported variable defaults.
- `{name}` placeholders found in the script or description are added to the Variables panel if they were not declared explicitly.
- If no title header is present, the editor falls back to the filename.

### Execution Model

- Scripts run asynchronously in the browser.
- Instruction limit: 1,000,000 steps per run.
- Wall-clock timeout: 10 hours.
- Scripts can be paused and resumed using the Pause and Resume buttons.
- The Stop button terminates execution at the next instruction.
- Runtime errors (divide by zero, undefined variable) stop execution with a message.

### Preview Mode

Scripts can be previewed without a connected machine.

The preview engine dry-runs the script and shows a timeline of SEND, PRINT, and WAIT events. This is useful for checking loop logic and inspecting the sequence of GRBL commands that will be sent before connecting to a machine.

During preview:

- `INPUT()`, `READ()`, `SETTING()`, and `STATE()` return `0`
- SEND commands appear as motion events in the preview log
- Preview stops at the instruction limit or on a script error

### Share URL System

Scripts are saved server-side and shared via a short opaque ID:

```
https://gcomposer.app/?gcom=abc123
```

The "Save Script" button saves the script to the server and assigns it an ID. Once saved, "Copy Share Link" copies the URL for that ID.

Variable overrides are individual extra query parameters:

```
https://gcomposer.app/?gcom=abc123&feedrate=2000&passes=5
```

Any query key not in the app's reserved list is treated as a variable override. Reserved keys that cannot be used as variable names: `gcom`, `preset`, `cmd`, `cmds`, `name`, `baud`, `dtr`, `observe`, `wait`, `delay`, `banner_timeout`, `banner_wait`, `show_req_resp`, `source`, `scrape`, `post`, `gcom_post`.

### Validator

Before running or saving, scripts are checked for:

- Syntax errors, highlighted with line numbers
- Unknown function or variable names
- Jumps to non-existent line numbers
- Backward loop patterns that may cause infinite loops

### Help Page

The app has a built-in GCOM help page accessible from the GCOM panel. It covers all statements and functions with short examples.
