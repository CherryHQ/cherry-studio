import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertOwnedProcess } from '../../../../scripts/e2e/regression/process'
import { WINDOWS_DIAGNOSTIC_RECTANGLE } from '../../../../scripts/e2e/regression/windowsNativeDiagnostics'
import type { RegressionApp } from '../RegressionApp'
import { inspectStartup } from './startupInspection'

export async function openWindowsTrayMenu(app: RegressionApp): Promise<void> {
  if (app.record.platform !== 'windows') throw new Error('Windows tray automation requires Windows')
  const state = await inspectStartup(app, 'tray-menu')
  const directory = join(app.paths.evidence, 'native-diagnostics')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, `windows-tray-accessibility-${app.record.electronPid}.json`),
    JSON.stringify({
      ownedPid: app.record.electronPid,
      accessibilitySupportEnabled: state.accessibilitySupportEnabled
    }),
    { mode: 0o600 }
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
    '$failure = $null; $names = @()',
    'try {',
    '$itemCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::MenuItem)',
    '$visibleCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::IsOffscreenProperty, $false)',
    '$menuCondition = [Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@($processCondition, $itemCondition, $visibleCondition))',
    '$items = @()',
    'foreach ($root in @($roots | Where-Object { -not $_.Current.IsOffscreen })) {',
    '  foreach ($item in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $menuCondition)) {',
    '    $ancestor = $item; $withinRoot = $false',
    '    for ($depth = 0; $depth -lt 64 -and $null -ne $ancestor; $depth++) {',
    `      if ($ancestor.Current.ProcessId -ne ${record.electronPid} -or $ancestor.Current.ControlType -eq [Windows.Automation.ControlType]::MenuBar) { break }`,
    '      if ($ancestor.Equals($root)) { $withinRoot = $true; break }',
    '      $ancestor = [Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($ancestor)',
    '    }',
    '    if ($withinRoot) { $items += $item }',
    '  }',
    '}',
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
    '} catch { $failure = $_ }',
    '$diagnostic = $null',
    'if ($names.Count -eq 0 -or $null -ne $failure) {',
    `$diagnostic = @{ ownedPid = ${record.electronPid}; nodes = @(); error = $null }`,
    'try {',
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TrayState { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'`,
    '[uint32]$foregroundPid = 0',
    '$null = [TrayState]::GetWindowThreadProcessId([TrayState]::GetForegroundWindow(), [ref]$foregroundPid)',
    `$windows = @($roots | Select-Object -First 8 | ForEach-Object { $current = $_.Current; $rect = $current.BoundingRectangle; @{ windowClass = $current.ClassName; controlType = $current.ControlType.ProgrammaticName; rect = ${WINDOWS_DIAGNOSTIC_RECTANGLE} } })`,
    '$diagnostic.foregroundPid = $foregroundPid; $diagnostic.windows = $windows',
    '$queue = [System.Collections.Generic.Queue[object]]::new(); $queued = 0; $visited = 0; $depthLimited = $false',
    'foreach ($root in @($roots | Select-Object -First 8)) { $queue.Enqueue(@{ element = $root; depth = 0 }); $queued++ }',
    '$walker = [Windows.Automation.TreeWalker]::RawViewWalker',
    'while ($queue.Count -gt 0 -and $visited -lt 80) {',
    '  $entry = $queue.Dequeue(); $visited++',
    '  try {',
    '    $current = $entry.element.Current',
    '    $invoke = $entry.element.GetCurrentPropertyValue([Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty)',
    '    $expand = $entry.element.GetCurrentPropertyValue([Windows.Automation.AutomationElement]::IsExpandCollapsePatternAvailableProperty)',
    '    $diagnostic.nodes += @{ depth = $entry.depth; processId = $current.ProcessId; class = $current.ClassName; controlType = $current.ControlType.ProgrammaticName; isOffscreen = $current.IsOffscreen; supportsInvoke = $invoke; supportsExpand = $expand }',
    `    if ($current.ProcessId -ne ${record.electronPid}) { continue }`,
    '    if ($entry.depth -ge 6) { $depthLimited = $true }',
    '    if ($entry.depth -lt 6 -and $queued -lt 80) {',
    '      $child = $walker.GetFirstChild($entry.element)',
    '      while ($null -ne $child -and $queued -lt 80) {',
    '        $queue.Enqueue(@{ element = $child; depth = $entry.depth + 1 }); $queued++',
    '        $child = $walker.GetNextSibling($child)',
    '      }',
    '    }',
    '  } catch { $diagnostic.nodes += @{ depth = $entry.depth; errorType = $_.Exception.GetType().Name; hresult = $_.Exception.HResult } }',
    '}',
    '$diagnostic.visited = $visited; $diagnostic.truncated = ($queued -ge 80 -or $roots.Count -gt 8 -or $depthLimited -or $diagnostic.nodes.Count -gt 80)',
    '$diagnostic.nodes = @($diagnostic.nodes | Select-Object -First 80)',
    '} catch { $diagnostic.error = @{ errorType = $_.Exception.GetType().Name; hresult = $_.Exception.HResult } }',
    '}',
    'if ($null -ne $failure) { $names = @() }',
    'ConvertTo-Json -InputObject @{ names = $names; diagnostic = $diagnostic } -Depth 5 -Compress',
    'if ($null -ne $failure) { throw $failure }'
  ].join('; ')
  let output: string
  let executionError: unknown
  try {
    output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
  } catch (error) {
    executionError = error
    output = (error as { stdout?: string | Buffer }).stdout?.toString() ?? ''
  }
  let result: { names: string[]; diagnostic?: Record<string, unknown> }
  try {
    result = JSON.parse(output)
    if (result.diagnostic) {
      const directory = join(app.paths.evidence, 'native-diagnostics')
      mkdirSync(directory, { recursive: true })
      writeFileSync(
        join(directory, `windows-tray-empty-${record.electronPid}.json`),
        JSON.stringify({ at: new Date().toISOString(), ...result.diagnostic }),
        { mode: 0o600 }
      )
    }
  } catch (error) {
    throw executionError ?? error
  }
  if (executionError) throw executionError
  return result.names
}
