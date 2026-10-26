import { execFileSync } from 'node:child_process'

import { evaluateCdpExpression } from '../../../../scripts/e2e/regression/cdpClient'
import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import type { RegressionApp } from '../RegressionApp'

export function nativeComputerUse(script: string): string {
  return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 10_000 }).trim()
}

export function readNativePermission(panel: 'Privacy_Accessibility' | 'Privacy_ScreenCapture'): string {
  execFileSync('open', ['x-apple.systempreferences:com.apple.preference.security?' + panel], {
    timeout: 10_000
  })
  return nativeComputerUse(`
    tell application "System Events"
      tell process "System Settings"
        set frontmost to true
        repeat 20 times
          repeat with element in entire contents of window 1
            if role of element is "AXCheckBox" then
              if (name of element as text) contains "Open Computer Use" then
                return value of element as text
              end if
            end if
          end repeat
          delay 0.2
        end repeat
      end tell
    end tell
    error "UNCOVERED: Open Computer Use permission checkbox is not exposed by System Settings"
  `)
}

export async function computerUseMain<T>(app: RegressionApp, body: string): Promise<T> {
  const record = app.record
  assertOwnedProcess(record, record.electronPid, 'electron')
  if (findListeningPid(record.platform, MAIN_INSPECTOR_PORT) !== record.electronPid) {
    throw new Error('UNCOVERED: the run-owned application has no accessible main-process inspector')
  }
  const response = await fetch(`http://127.0.0.1:${MAIN_INSPECTOR_PORT}/json/list`)
  const targets = (await response.json()) as { type: string; webSocketDebuggerUrl: string }[]
  const target = targets.find(({ type }) => type === 'node')
  if (!target) throw new Error('UNCOVERED: run-owned main-process inspector target is missing')
  return evaluateCdpExpression<T>(
    target.webSocketDebuggerUrl,
    `(async () => {
      const application = Object.values(process.mainModule.require.cache)
        .map(module => module.exports?.application).find(candidate => candidate?.get)
      if (!application) throw new Error('UNCOVERED: application service inspection is unavailable')
      const service = application.get('ComputerUseService')
      ${body}
    })()`
  )
}

export function stopNativeDesktopControl(pid: number): string {
  return nativeComputerUse(`
    tell application "System Events"
      tell (first process whose unix id is ${pid})
        click menu bar item 1 of menu bar 2
        delay 0.3
        tell menu 1 of menu bar item 1 of menu bar 2
          click menu item "桌面控制"
          delay 0.3
          tell menu 1 of menu item "桌面控制"
            set actualLabel to name of menu item "停止所有桌面控制"
            click menu item "停止所有桌面控制"
            return actualLabel
          end tell
        end tell
      end tell
    end tell
  `)
}
