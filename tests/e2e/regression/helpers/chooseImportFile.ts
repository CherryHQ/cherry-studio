import { execFileSync } from 'node:child_process'

import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import type { RegressionApp } from '../RegressionApp'

export function chooseImportFile(app: RegressionApp, path: string): void {
  if (app.record.platform !== 'macos') {
    chooseNativeFile(app.record.platform, app.paths, path)
    return
  }
  // macOS localizes native panels independently of the application's English test locale.
  execFileSync(
    'osascript',
    [
      '-e',
      `
    on run argv
      tell application "System Events"
        tell (first application process whose unix id is (item 2 of argv as integer))
          set frontmost to true
          repeat 100 times
            if exists splitter group 1 of window 1 then
              if exists button "Open" of splitter group 1 of window 1 then exit repeat
              if exists button "打开" of splitter group 1 of window 1 then exit repeat
            end if
            delay 0.1
          end repeat
          if exists button "Open" of splitter group 1 of window 1 then
            set openButton to button "Open" of splitter group 1 of window 1
          else
            set openButton to button "打开" of splitter group 1 of window 1
          end if
          keystroke "g" using {command down, shift down}
          repeat 100 times
            if exists text field 1 of sheet 1 of window 1 then exit repeat
            delay 0.1
          end repeat
          set value of text field 1 of sheet 1 of window 1 to item 1 of argv
          key code 36
          repeat 100 times
            if not (exists sheet 1 of window 1) then exit repeat
            delay 0.1
          end repeat
          repeat 100 times
            if enabled of openButton then exit repeat
            delay 0.1
          end repeat
          click openButton
        end tell
      end tell
    end run
  `,
      '--',
      path,
      String(app.record.electronPid)
    ],
    { timeout: 45_000, stdio: 'pipe' }
  )
}
