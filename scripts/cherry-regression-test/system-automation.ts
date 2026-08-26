import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { readAppRecord } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import type { Platform } from './types'

const ALLOWED_KEYS = new Set(['Alt', 'Control', 'Enter', 'Escape', 'Meta', 'Shift', 'Space', 'a', 'e', 'k', 'q', 's'])

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function runMacHotkey(keys: string[]): void {
  const modifiers = keys
    .filter((key) => ['Alt', 'Control', 'Meta', 'Shift'].includes(key))
    .map((key) => ({ Alt: 'option down', Control: 'control down', Meta: 'command down', Shift: 'shift down' })[key])
  const key = keys.find((candidate) => !['Alt', 'Control', 'Meta', 'Shift'].includes(candidate))
  if (!key) throw new Error('A hotkey must include a non-modifier key')
  const namedCodes: Record<string, number> = { Enter: 36, Escape: 53, Space: 49 }
  const action = namedCodes[key] === undefined ? `keystroke ${JSON.stringify(key)}` : `key code ${namedCodes[key]}`
  const script = `tell application "System Events" to ${action}${modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : ''}`
  execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 10_000 })
}

function runWindowsHotkey(keys: string[]): void {
  if (keys.length === 1 && keys[0] === 'Control') {
    const script = [
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeKeyboard { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'`,
      '[NativeKeyboard]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)',
      'Start-Sleep -Milliseconds 400',
      '[NativeKeyboard]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)',
      'Start-Sleep -Milliseconds 50',
      '[NativeKeyboard]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)'
    ].join('; ')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 10_000
    })
    return
  }

  const virtualKeys: Record<string, number> = {
    Alt: 0x12,
    Control: 0x11,
    Enter: 0x0d,
    Escape: 0x1b,
    Meta: 0x5b,
    Shift: 0x10,
    Space: 0x20
  }
  const modifiers = keys.filter((key) => ['Alt', 'Control', 'Meta', 'Shift'].includes(key))
  const key = keys.find((candidate) => !['Alt', 'Control', 'Meta', 'Shift'].includes(candidate))
  if (!key) throw new Error('A hotkey must include a non-modifier key')
  const keyCode = virtualKeys[key] ?? key.toUpperCase().charCodeAt(0)
  const script = [
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeKeyboard { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'`,
    ...modifiers.map((modifier) => `[NativeKeyboard]::keybd_event(${virtualKeys[modifier]}, 0, 0, [UIntPtr]::Zero)`),
    `[NativeKeyboard]::keybd_event(${keyCode}, 0, 0, [UIntPtr]::Zero)`,
    `[NativeKeyboard]::keybd_event(${keyCode}, 0, 2, [UIntPtr]::Zero)`,
    ...modifiers
      .toReversed()
      .map((modifier) => `[NativeKeyboard]::keybd_event(${virtualKeys[modifier]}, 0, 2, [UIntPtr]::Zero)`)
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    timeout: 10_000
  })
}

export function sendSystemHotkey(platform: Platform, keys: string[]): void {
  if (keys.length === 0 || keys.some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error(`Unsupported desktop hotkey: ${keys.join('+')}`)
  }
  if (platform === 'macos') runMacHotkey(keys)
  else runWindowsHotkey(keys)
}

export function openExternalText(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.fixtures])
  if (!existsSync(filePath)) throw new Error(`External text fixture does not exist: ${filePath}`)
  if (platform === 'macos') {
    execFileSync('open', ['-a', 'TextEdit', filePath], { stdio: 'ignore', timeout: 10_000 })
    execFileSync(
      'osascript',
      [
        '-e',
        'tell application "TextEdit" to activate',
        '-e',
        'delay 1',
        '-e',
        'tell application "System Events" to keystroke "a" using command down'
      ],
      { stdio: 'ignore', timeout: 10_000 }
    )
  } else {
    const script = [
      `$process = Start-Process notepad.exe -ArgumentList '${escapePowerShell(filePath)}' -PassThru`,
      '$null = $process.WaitForInputIdle(5000)',
      '$shell = New-Object -ComObject WScript.Shell',
      'if (-not $shell.AppActivate($process.Id)) { throw "Notepad window could not be activated" }',
      'Start-Sleep -Milliseconds 500',
      '$shell.SendKeys("^a")'
    ].join('\n')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15_000
    })
  }
  return filePath
}

export function chooseNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.fixtures, paths.workspace, paths.evidence])
  if (!existsSync(filePath)) throw new Error(`Selected file does not exist: ${filePath}`)
  const electronPid = readAppRecord(paths).electronPid
  if (platform === 'macos') {
    const script = [
      'on run argv',
      'tell application "System Events"',
      'set frontmost of first application process whose unix id is (item 2 of argv as integer) to true',
      'delay 0.5',
      'keystroke "g" using {command down, shift down}',
      'delay 1',
      'keystroke (item 1 of argv)',
      'key code 36',
      'delay 1.5',
      'key code 36',
      'end tell',
      'end run'
    ].join('\n')
    execFileSync('osascript', ['-e', script, '--', filePath, String(electronPid)], {
      stdio: 'ignore',
      timeout: 15_000
    })
  } else {
    const isDirectory = statSync(filePath).isDirectory()
    const script = [
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      '$root = [System.Windows.Automation.AutomationElement]::RootElement',
      `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${electronPid})`,
      '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
      '$dialog = $null',
      'do {',
      '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
      '  $dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" } | Select-Object -Last 1',
      '  if (-not $dialog) { Start-Sleep -Milliseconds 200 }',
      '} while (-not $dialog -and [DateTime]::UtcNow -lt $deadline)',
      'if (-not $dialog) { throw "Native file dialog was not found" }',
      '$shell = New-Object -ComObject WScript.Shell',
      `if (-not $shell.AppActivate(${electronPid})) { throw "Native file dialog could not be activated" }`,
      'Start-Sleep -Milliseconds 300',
      ...(isDirectory
        ? [
            'Add-Type -AssemblyName System.Windows.Forms',
            '[System.Windows.Forms.SendKeys]::SendWait("^l")',
            'Start-Sleep -Milliseconds 200',
            '$pathInput = [System.Windows.Automation.AutomationElement]::FocusedElement',
            '$valuePattern = $pathInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            `$valuePattern.SetValue('${escapePowerShell(filePath)}')`,
            '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
            'Start-Sleep -Milliseconds 500',
            '$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
            '$dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" } | Select-Object -Last 1',
            'if (-not $dialog) { throw "Native folder dialog closed before selection" }',
            '$buttonCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)',
            '$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)',
            '$selectButton = $buttons | Where-Object { $_.Current.Name -in @("Select Folder", "Choose Folder", "Choose this folder", "Select") } | Select-Object -First 1',
            'if (-not $selectButton) { throw "Select Folder button was not found" }',
            '$selectButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()'
          ]
        : [
            '$fileNameCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1148")',
            '$fileNameInput = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileNameCondition)',
            'if (-not $fileNameInput) { throw "File name input was not found" }',
            '$valuePattern = $fileNameInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            `$valuePattern.SetValue('${escapePowerShell(filePath)}')`,
            '$openCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, "Open")',
            '$openButton = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $openCondition)',
            'if (-not $openButton) { throw "Open button was not found" }',
            '$openButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()'
          ])
    ].join('\n')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15_000
    })
  }
  return filePath
}

export function saveNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.evidence])
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const electronPid = readAppRecord(paths).electronPid
  if (platform === 'macos') {
    const script = [
      'on run argv',
      'tell application "System Events"',
      'set frontmost of first application process whose unix id is (item 3 of argv as integer) to true',
      'delay 0.5',
      'keystroke "g" using {command down, shift down}',
      'delay 1',
      'keystroke (item 1 of argv)',
      'key code 36',
      'delay 1',
      'keystroke "a" using command down',
      'keystroke (item 2 of argv)',
      'key code 36',
      'end tell',
      'end run'
    ].join('\n')
    execFileSync('osascript', ['-e', script, '--', directory, basename(filePath), String(electronPid)], {
      stdio: 'ignore',
      timeout: 15_000
    })
  } else {
    const script = [
      '$shell = New-Object -ComObject WScript.Shell',
      `$null = $shell.AppActivate(${electronPid})`,
      'Start-Sleep -Milliseconds 500',
      '$shell.SendKeys("%n")',
      'Start-Sleep -Milliseconds 250',
      `$shell.SendKeys('${escapePowerShell(filePath)}')`,
      '$shell.SendKeys("{ENTER}")'
    ].join('; ')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 15_000
    })
  }
  return filePath
}
