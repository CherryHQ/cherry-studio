import { execFileSync } from 'node:child_process'

import { evaluateCdpExpression } from '../../../../scripts/e2e/regression/cdpClient'
import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import { openMacTrayMenu } from '../../../../scripts/e2e/regression/systemAutomation'
import type { RegressionApp } from '../RegressionApp'

export function nativeComputerUse(script: string, timeout = 10_000): string {
  return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout }).trim()
}

const permissionPanelTitles = {
  Privacy_Accessibility: ['Accessibility', '辅助功能', '设备控制和数据访问'],
  Privacy_ScreenCapture: ['Screen Recording', 'Screen & System Audio Recording', '录屏与系统录音', '屏幕录制']
} as const

export function isNativePermissionPanelOpen(panel: keyof typeof permissionPanelTitles): boolean {
  return (
    nativeComputerUse(`
    tell application "System Events" to tell process "System Settings"
      if not (exists window 1) then return false
      return {${permissionPanelTitles[panel].map((title) => JSON.stringify(title)).join(', ')}} contains (name of window 1 as text)
    end tell
  `) === 'true'
  )
}

export function readNativePermission(panel: keyof typeof permissionPanelTitles): string {
  execFileSync('open', ['x-apple.systempreferences:com.apple.preference.security?' + panel], {
    timeout: 10_000
  })
  const titles = permissionPanelTitles[panel]
  return nativeComputerUse(
    `
    tell application "System Events"
      tell process "System Settings"
        set frontmost to true
        repeat 40 times
          if exists window 1 then
            if {${titles.map((title) => JSON.stringify(title)).join(', ')}} contains name of window 1 then
            set elementsSnapshot to entire contents of window 1
            repeat with elementReference in elementsSnapshot
              set element to contents of elementReference
              if role of element is "AXCheckBox" then
                if (name of element as text) contains "Cherry Computer Use" then
                  return value of element as text
                end if
              end if
            end repeat
            return "not-listed"
            end if
          end if
          delay 0.2
        end repeat
      end tell
    end tell
    error "UNCOVERED: Cherry Computer Use permission checkbox is not exposed by System Settings"
  `,
    30_000
  )
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
      const application = Object.values(process.mainModule.require('node:module')._cache)
        .map(module => module.exports?.application).find(candidate => candidate?.get)
      if (!application) throw new Error('UNCOVERED: application service inspection is unavailable')
      const service = application.get('ComputerUseService')
      ${body}
    })()`
  )
}

export function stopNativeDesktopControl(app: RegressionApp): string {
  openMacTrayMenu(app.paths)
  return nativeComputerUse(`
    tell application "System Events"
      tell (first process whose unix id is ${app.record.electronPid})
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
