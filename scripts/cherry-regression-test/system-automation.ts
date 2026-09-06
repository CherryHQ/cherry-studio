import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readAppRecord } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import type { Platform } from './types'

const ALLOWED_KEYS = new Set(['Alt', 'Control', 'Enter', 'Escape', 'Meta', 'Shift', 'Space', 'a', 'e', 'k', 's'])
let activeWindowsTextFixturePid: number | undefined

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
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
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; } public static class NativeKeyboard { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out NativeRect rect); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'`,
    activeWindowsTextFixturePid
      ? `$fixture = Get-Process -Id ${activeWindowsTextFixturePid} -ErrorAction SilentlyContinue`
      : '$fixture = $null',
    'if ($fixture) {',
    '  $shell = New-Object -ComObject WScript.Shell',
    '  if (-not $shell.AppActivate($fixture.Id)) { throw "External text window could not be activated" }',
    '  Start-Sleep -Milliseconds 200',
    '  $shell.SendKeys("^a")',
    '  Start-Sleep -Milliseconds 200',
    // selection-hook reads the window under the pointer on Windows.
    '  $rect = [NativeRect]::new()',
    '  if (-not [NativeKeyboard]::GetWindowRect($fixture.MainWindowHandle, [ref]$rect)) { throw "External text window bounds could not be read" }',
    '  $null = [NativeKeyboard]::SetCursorPos([int](($rect.Left + $rect.Right) / 2), [int](($rect.Top + $rect.Bottom) / 2))',
    '  Start-Sleep -Milliseconds 100',
    '}',
    ...modifiers.map((modifier) => `[NativeKeyboard]::keybd_event(${virtualKeys[modifier]}, 0, 0, [UIntPtr]::Zero)`),
    'Start-Sleep -Milliseconds 100',
    `[NativeKeyboard]::keybd_event(${keyCode}, 0, 0, [UIntPtr]::Zero)`,
    'Start-Sleep -Milliseconds 100',
    `[NativeKeyboard]::keybd_event(${keyCode}, 0, 2, [UIntPtr]::Zero)`,
    ...modifiers
      .toReversed()
      .map((modifier) => `[NativeKeyboard]::keybd_event(${virtualKeys[modifier]}, 0, 2, [UIntPtr]::Zero)`),
    'Start-Sleep -Milliseconds 500'
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
    const fixtureHtmlPath = join(paths.fixtures, 'windows-selection-fixture.html')
    const browserProfilePath = join(paths.fixtures, 'windows-selection-browser-profile')
    mkdirSync(browserProfilePath, { recursive: true })
    writeFileSync(
      fixtureHtmlPath,
      [
        '<!doctype html>',
        '<meta charset="utf-8">',
        '<title>Cherry Regression Selection Fixture</title>',
        '<style>html,body,textarea{box-sizing:border-box;width:100%;height:100%;margin:0}textarea{padding:24px;font:24px sans-serif}</style>',
        `<textarea autofocus>${escapeHtml(readFileSync(filePath, 'utf8').trim())}</textarea>`,
        '<script>addEventListener("load",()=>{const area=document.querySelector("textarea");area.focus();area.select()})</script>'
      ].join('\n'),
      'utf8'
    )
    const fixtureUrl = pathToFileURL(fixtureHtmlPath).href
    const script = [
      '$browserCandidates = @(',
      '  "${env:ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe",',
      '  "${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",',
      '  "${env:ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe",',
      '  "${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe"',
      ')',
      '$browserPath = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
      'if (-not $browserPath) { throw "Chrome or Edge was not found" }',
      `$fixtureArgs = @('--user-data-dir="${escapePowerShell(browserProfilePath)}"', '--no-first-run', '--disable-default-apps', '--disable-extensions', '--new-window', '--window-size=800,400', '--window-position=100,100', '"${escapePowerShell(fixtureUrl)}"')`,
      '$fixture = Start-Process -FilePath $browserPath -ArgumentList $fixtureArgs -PassThru',
      '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
      'do { $fixture.Refresh(); if ($fixture.MainWindowHandle -eq 0) { Start-Sleep -Milliseconds 200 } } while ($fixture.MainWindowHandle -eq 0 -and -not $fixture.HasExited -and [DateTime]::UtcNow -lt $deadline)',
      'if ($fixture.MainWindowHandle -eq 0) { throw "External text window was not found" }',
      '$shell = New-Object -ComObject WScript.Shell',
      'if (-not $shell.AppActivate($fixture.Id)) { throw "External text window could not be activated" }',
      'Start-Sleep -Milliseconds 1000',
      '$shell.SendKeys("^a")',
      'Start-Sleep -Milliseconds 500',
      '$fixture.Id'
    ].join('\n')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000
    })
    const processId = Number.parseInt(output.trim(), 10)
    if (!Number.isInteger(processId) || processId <= 0) throw new Error('External text process ID was not returned')
    activeWindowsTextFixturePid = processId
  }
  return filePath
}

export function selectExternalText(platform: Platform): void {
  if (platform === 'macos') {
    runMacHotkey(['Meta', 'a'])
    return
  }
  if (!activeWindowsTextFixturePid) throw new Error('No external text window is active')

  const script = [
    `$fixture = Get-Process -Id ${activeWindowsTextFixturePid} -ErrorAction Stop`,
    '$shell = New-Object -ComObject WScript.Shell',
    'if (-not $shell.AppActivate($fixture.Id)) { throw "External text window could not be activated" }',
    'Start-Sleep -Milliseconds 200',
    'Set-Clipboard -Value ""',
    '$shell.SendKeys("^a")',
    'Start-Sleep -Milliseconds 200',
    '$shell.SendKeys("^c")',
    'Start-Sleep -Milliseconds 300',
    '$selectedText = Get-Clipboard -Raw',
    'if ([string]::IsNullOrWhiteSpace($selectedText)) { throw "External browser text selection is empty" }',
    '$shell.SendKeys("^a")',
    'Start-Sleep -Milliseconds 300'
  ].join('\n')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 10_000
  })
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
      'Set-StrictMode -Version Latest',
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      'Add-Type -AssemblyName System.Windows.Forms',
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeDialog { [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'`,
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
            '[System.Windows.Forms.SendKeys]::SendWait("^l")',
            'Start-Sleep -Milliseconds 200',
            `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShell(filePath)}')`,
            '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
            'Start-Sleep -Milliseconds 750',
            '$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
            '$dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" } | Select-Object -Last 1',
            'if (-not $dialog) { throw "Native folder dialog closed before selection" }',
            '$acceptHandle = [NativeDialog]::GetDlgItem([IntPtr]$dialog.Current.NativeWindowHandle, 1)',
            'if ($acceptHandle -eq [IntPtr]::Zero) { throw "Native folder accept button was not found" }',
            '$null = [NativeDialog]::SendMessage($acceptHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
            'Start-Sleep -Milliseconds 500'
          ]
        : [
            '[System.Windows.Forms.SendKeys]::SendWait("%n")',
            'Start-Sleep -Milliseconds 200',
            `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShell(filePath)}')`,
            '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")'
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
      'delay 2',
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
    const extension = extname(filePath)
    const saveName = extension ? basename(filePath, extension) : basename(filePath)
    execFileSync('osascript', ['-e', script, '--', directory, saveName, String(electronPid)], {
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
