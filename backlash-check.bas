REM TITLE: Manual Backlash Check
REM VERSION: 1
REM AUTHOR: GitHub Copilot
REM DESCRIPTION: Repeats a short out-and-back move on the {axis} axis.
REM DESCRIPTION: After each reverse move, enter the dial indicator offset you see at zero in {units_label}.
REM DESCRIPTION: The script averages the readings and reports the largest value as a simple backlash estimate.
REM VAR axis=X
REM VAR travel_mm=2
REM VAR feed_mm_min=150
REM VAR settle_ms=400
REM VAR repeats=5
REM VAR idle_timeout_ms=8000
REM VAR units_label=mm

10 PRINT "Manual backlash check for axis {axis}"
20 PRINT "Mount a dial indicator on the {axis} axis and zero it before starting."
30 PRINT "This test uses relative moves and returns to the same nominal zero each cycle."
40 CONFIRM "Ready to test backlash on axis {axis}?"
50 LET total_error = 0
60 LET max_error = 0
70 LET min_error = 0
80 LET reading = 0
90 SEND "G21" TIMEOUT 1000 REQUIRE_OK
100 SEND "G91" TIMEOUT 1000 REQUIRE_OK
110 WAIT {settle_ms}
120 PRINT "Starting " & STR({repeats}) & " backlash cycles..."
130 FOR pass = 1 TO {repeats}
140 PRINT "Pass " & STR(pass) & " of " & STR({repeats})
150 SEND "G1 {axis}" & STR({travel_mm}) & " F" & STR({feed_mm_min}) TIMEOUT 3000 REQUIRE_OK
160 WAIT_IDLE {idle_timeout_ms}
170 WAIT {settle_ms}
180 SEND "G1 {axis}-" & STR({travel_mm}) & " F" & STR({feed_mm_min}) TIMEOUT 3000 REQUIRE_OK
190 WAIT_IDLE {idle_timeout_ms}
200 WAIT {settle_ms}
210 LET reading = INPUT("Pass " & STR(pass) & ": enter indicator offset at zero in {units_label}")
220 LET total_error = total_error + reading
230 IF pass <> 1 THEN GOTO 270
240 LET min_error = reading
250 LET max_error = reading
260 GOTO 320
270 IF reading > max_error THEN GOTO 290
280 GOTO 300
290 LET max_error = reading
300 IF reading < min_error THEN GOTO 320
310 GOTO 330
320 LET min_error = reading
330 NEXT pass
340 LET avg_error = total_error / {repeats}
350 PRINT "Average backlash estimate = " & STR(avg_error) & " {units_label}"
360 PRINT "Largest entered reading = " & STR(max_error) & " {units_label}"
370 PRINT "Smallest entered reading = " & STR(min_error) & " {units_label}"
380 RESULT "axis", "{axis}"
390 RESULT "travel_mm", {travel_mm}
400 RESULT "feed_mm_min", {feed_mm_min}
410 RESULT "repeat_count", {repeats}
420 RESULT "avg_backlash", avg_error
430 RESULT "max_backlash", max_error
440 RESULT "min_backlash", min_error
450 REPORT
460 END