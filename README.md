# GRBL Diagnostic

A simple browser-based serial terminal for troubleshooting GRBL CNC connections.

This tool is meant to help when a GRBL controller will not connect properly, does not answer, stays busy, resets unexpectedly, or behaves differently between programs.

## What This App Does

This app opens a serial connection to a GRBL controller using the browser's Web Serial feature.

It can help you:

- connect to a GRBL device from the browser
- see exactly what the controller sends back
- send simple GRBL commands like `?`, `$$`, `$I`, and `$X`
- test different startup behaviors
- test different DTR behaviors
- copy a structured diagnostics log for support or forum posts
- share test setups using links

## Why This Is Useful

When a CNC program like MillMage has trouble connecting, it is often not clear whether the problem is:

- the app
- the USB serial connection
- the GRBL board
- reset timing on connect
- DTR behavior
- firmware startup timing
- alarm state or controller state

This tool helps separate those problems by showing the raw serial behavior directly.

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

GRBL Diagnostic is a simple browser tool for checking whether a GRBL controller is opening, resetting, sending startup output, answering commands, and responding reliably.

It is mainly intended to make GRBL connection problems easier to see, compare, and share.
