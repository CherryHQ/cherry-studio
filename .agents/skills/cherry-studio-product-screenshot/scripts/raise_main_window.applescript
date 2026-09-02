on run argv
  if (count of argv) is not 1 then error "usage: raise_main_window.applescript <pid>"
  set targetPID to (item 1 of argv) as integer

  tell application "System Events"
    set targetProcess to first application process whose unix id is targetPID
    set frontmost of targetProcess to true
    delay 0.2
    set mainWindows to {}
    repeat with candidateWindow in every window of targetProcess
      set candidateSize to size of candidateWindow
      if (item 1 of candidateSize) is greater than or equal to 1000 and (item 2 of candidateSize) is greater than or equal to 700 then
        set end of mainWindows to candidateWindow
      end if
    end repeat
    if (count of mainWindows) is not 1 then error "expected one Cherry Studio main window"
    perform action "AXRaise" of item 1 of mainWindows
  end tell
end run
