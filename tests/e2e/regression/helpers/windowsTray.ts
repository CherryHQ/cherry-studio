import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertOwnedProcess } from '../../../../scripts/e2e/regression/process'
import { WINDOWS_DIAGNOSTIC_RECTANGLE } from '../../../../scripts/e2e/regression/windowsNativeDiagnostics'
import type { RegressionApp } from '../RegressionApp'
import { inspectStartup } from './startupInspection'

export async function openWindowsTrayMenu(app: RegressionApp): Promise<void> {
  const { trays } = await inspectStartup(app)
  const active = trays.filter(({ destroyed, bounds }) => !destroyed && bounds.width > 0 && bounds.height > 0)
  if (active.length !== 1 || !active[0].screenPoint) throw new Error('Expected one visible owned tray icon')
  const { x, y } = active[0].screenPoint
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TrayMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra); }'`,
        `if (-not [TrayMouse]::SetCursorPos(${x}, ${y})) { throw "Could not reach the owned tray icon" }`,
        '[TrayMouse]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)',
        '[TrayMouse]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)'
      ].join('; ')
    ],
    { timeout: 10_000, windowsHide: true }
  )
}

export function windowsTrayMenu(app: RegressionApp, label?: string, expand = false): string[] {
  const record = app.record
  if (record.platform !== 'windows') throw new Error('Windows tray automation requires Windows')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    `$processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${record.electronPid})`,
    '$roots = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)',
    '$itemCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::MenuItem)',
    '$items = @($roots | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Menu } | ForEach-Object { $_.FindAll([Windows.Automation.TreeScope]::Descendants, $itemCondition) })',
    '$names = @($items | ForEach-Object { $_.Current.Name })',
    ...(label
      ? [
          `$targets = @($items | Where-Object { $_.Current.Name -eq '${label.replaceAll("'", "''")}' })`,
          'if ($targets.Count -ne 1) { throw "The owned tray menu item was not found uniquely" }',
          expand
            ? '$targets[0].GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()'
            : '$targets[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()'
        ]
      : []),
    '$diagnostic = $null',
    'if ($names.Count -eq 0) {',
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TrayState { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'`,
    '[uint32]$foregroundPid = 0',
    '$null = [TrayState]::GetWindowThreadProcessId([TrayState]::GetForegroundWindow(), [ref]$foregroundPid)',
    `$windows = @($roots | Select-Object -First 8 | ForEach-Object { $current = $_.Current; $rect = $current.BoundingRectangle; @{ windowClass = $current.ClassName; controlType = $current.ControlType.ProgrammaticName; rect = ${WINDOWS_DIAGNOSTIC_RECTANGLE} } })`,
    `$diagnostic = @{ ownedPid = ${record.electronPid}; foregroundPid = $foregroundPid; windows = $windows }`,
    '}',
    'ConvertTo-Json -InputObject @{ names = $names; diagnostic = $diagnostic } -Depth 5 -Compress'
  ].join('; ')
  const result = JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
  )
  if (result.diagnostic) {
    const directory = join(app.paths.evidence, 'native-diagnostics')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `windows-tray-empty-${record.electronPid}.json`),
      JSON.stringify({ at: new Date().toISOString(), ...result.diagnostic }),
      { mode: 0o600 }
    )
  }
  return result.names
}
