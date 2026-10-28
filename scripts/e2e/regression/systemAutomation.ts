import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readAppRecord, readOwnedRecord } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import { assertOwnedProcess, findCdpPid, isDescendant } from './process'
import type { Platform } from './types'

const ALLOWED_KEYS = new Set(['Alt', 'Control', 'Enter', 'Escape', 'Meta', 'Shift', 'Space', 'a', 'e', 'k', 's'])
let activeWindowsTextFixturePid: number | undefined
let activeMacTextFixturePath: string | undefined
let macProductMajor: number | undefined

export function closeExternalText(platform: Platform): void {
  if (platform === 'macos' && activeMacTextFixturePath) {
    const script = [
      'on run argv',
      'tell application "System Events"',
      'if not (exists process "TextEdit") then return',
      'tell process "TextEdit"',
      'repeat with docWindow in windows',
      'if exists attribute "AXDocument" of docWindow then',
      'if value of attribute "AXDocument" of docWindow is item 1 of argv then',
      'click (first button of docWindow whose subrole is "AXCloseButton")',
      'end if',
      'end if',
      'end repeat',
      'end tell',
      'end tell',
      'end run'
    ].join('\n')
    execFileSync('osascript', ['-e', script, '--', pathToFileURL(activeMacTextFixturePath).href], {
      stdio: 'ignore',
      timeout: 10_000
    })
    activeMacTextFixturePath = undefined
    return
  }
  if (platform !== 'windows' || !activeWindowsTextFixturePid) return
  try {
    execFileSync('taskkill.exe', ['/PID', String(activeWindowsTextFixturePid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 10_000
    })
  } catch {
    // The browser may have already exited.
  } finally {
    activeWindowsTextFixturePid = undefined
  }
}

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

function runAsync(file: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

/**
 * Acknowledge a native message box raised by the main process itself. The process is
 * blocked inside the modal call, so nothing inside the page can dismiss it: click the
 * box's default button from the desktop instead. Resolves once the box is gone.
 */
export async function dismissNativeMessageBox(platform: Platform, paths: RunPaths, title: string): Promise<void> {
  const record = readOwnedRecord(paths)
  let electronPid = record.electronPid
  const deadline = Date.now() + 60_000
  while (!electronPid && Date.now() < deadline) {
    electronPid = findCdpPid(platform)
    if (!electronPid) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!electronPid) throw new Error('Owned application did not open its CDP port before the native dialog')
  assertOwnedProcess(record, electronPid, 'electron')
  if (!isDescendant(electronPid, record.runnerPid, platform))
    throw new Error('Native dialog process is outside the owned run')
  if (platform === 'macos') {
    const script = [
      'on run argv',
      'set targetPid to item 2 of argv as integer',
      'tell application "System Events"',
      'repeat 240 times',
      'if exists (first application process whose unix id is targetPid) then',
      'tell (first application process whose unix id is targetPid)',
      'repeat with w in windows',
      'if exists button "OK" of w then',
      'click button "OK" of w',
      'return "window"',
      'end if',
      'if (count of sheets of w) > 0 then',
      'repeat with s in sheets of w',
      'if exists button "OK" of s then',
      'click button "OK" of s',
      'return "sheet"',
      'end if',
      'end repeat',
      'end if',
      'end repeat',
      'end tell',
      'end if',
      'delay 0.25',
      'end repeat',
      'error "Native message box was not found"',
      'end tell',
      'end run'
    ].join('\n')
    return runAsync('osascript', ['-e', script, '--', title, String(electronPid)], 90_000)
  }
  const script = [
    'Set-StrictMode -Version Latest',
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeMessageBox { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'`,
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${electronPid})`,
    '$deadline = [DateTime]::UtcNow.AddSeconds(60)',
    '$dialog = $null',
    'do {',
    '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
    `  $dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" -and $_.Current.Name -eq '${escapePowerShell(title)}' } | Select-Object -Last 1`,
    '  if (-not $dialog) { Start-Sleep -Milliseconds 200 }',
    '} while (-not $dialog -and [DateTime]::UtcNow -lt $deadline)',
    'if (-not $dialog) { throw "Native message box was not found" }',
    '$buttonCondition = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "CommandButton_1"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1"))',
    '$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)',
    'if (-not $button -or -not $button.Current.NativeWindowHandle) { throw "Native message box confirmation button was not found" }',
    '$null = [NativeMessageBox]::SendMessage([IntPtr]$button.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 500'
  ].join('\n')
  return runAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    90_000
  )
}

export function openExternalText(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.fixtures])
  if (!existsSync(filePath)) throw new Error(`External text fixture does not exist: ${filePath}`)
  if (platform === 'macos') {
    closeExternalText(platform)
    activeMacTextFixturePath = filePath
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
    closeExternalText(platform)
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
      'Start-Process -FilePath $browserPath -ArgumentList $fixtureArgs | Out-Null',
      '$deadline = [DateTime]::UtcNow.AddSeconds(20)',
      '$fixture = $null',
      'do {',
      '  $fixture = Get-Process chrome,msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "Cherry Regression Selection Fixture*" } | Select-Object -First 1',
      '  if (-not $fixture) { Start-Sleep -Milliseconds 200 }',
      '} while (-not $fixture -and [DateTime]::UtcNow -lt $deadline)',
      'if (-not $fixture) { throw "External text window was not found" }',
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
      timeout: 30_000
    })
    const processId = Number.parseInt(output.trim(), 10)
    if (!Number.isInteger(processId) || processId <= 0) throw new Error('External text process ID was not returned')
    activeWindowsTextFixturePid = processId
  }
  return filePath
}

export async function inspectImageInExternalBrowser(
  paths: RunPaths,
  candidatePath: string
): Promise<{ width: number; height: number; screenshot: string }> {
  const filePath = resolveAllowedPath(candidatePath, [paths.evidence])
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launchPersistentContext(join(paths.private, 'external-image-viewer'), {
    channel: 'msedge',
    headless: false
  })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(filePath).href)
    const image = page.locator('img')
    await image.waitFor({ state: 'visible' })
    const dimensions = await image.evaluate((element) => ({
      width: (element as HTMLImageElement).naturalWidth,
      height: (element as HTMLImageElement).naturalHeight
    }))
    const screenshot = join(paths.evidence, 'external-image-viewer.png')
    await page.screenshot({ path: screenshot })
    return { ...dimensions, screenshot }
  } finally {
    await browser.close()
  }
}

export function chooseNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.fixtures, paths.workspace, paths.evidence])
  if (!existsSync(filePath)) throw new Error(`Selected file does not exist: ${filePath}`)
  const electronPid = readAppRecord(paths).electronPid
  if (platform === 'macos') {
    const legacyScript = [
      'on run argv',
      'tell application "System Events"',
      'tell (first application process whose unix id is (item 2 of argv as integer))',
      'set frontmost to true',
      'repeat 100 times',
      'if exists button "Open" of splitter group 1 of window 1 then exit repeat',
      'delay 0.1',
      'end repeat',
      'if not (exists button "Open" of splitter group 1 of window 1) then error "Native file dialog was not found"',
      'keystroke "g" using {command down, shift down}',
      'repeat 100 times',
      'if exists text field 1 of sheet 1 of window 1 then exit repeat',
      'delay 0.1',
      'end repeat',
      'if not (exists text field 1 of sheet 1 of window 1) then error "Go to Folder input was not found"',
      'set value of text field 1 of sheet 1 of window 1 to item 1 of argv',
      'key code 36',
      'repeat 100 times',
      'if not (exists sheet 1 of window 1) then exit repeat',
      'delay 0.1',
      'if exists text field 1 of sheet 1 of window 1 then key code 36',
      'end repeat',
      'if exists sheet 1 of window 1 then error "Go to Folder did not finish"',
      'repeat 100 times',
      'if enabled of button "Open" of splitter group 1 of window 1 then exit repeat',
      'delay 0.1',
      'end repeat',
      'if not (enabled of button "Open" of splitter group 1 of window 1) then error "Selected path cannot be opened"',
      'click button "Open" of splitter group 1 of window 1',
      'end tell',
      'end tell',
      'end run'
    ].join('\n')
    macProductMajor ??= Number.parseInt(
      execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5_000 }).trim(),
      10
    )
    if (!Number.isInteger(macProductMajor)) throw new Error('Could not determine macOS product version')
    // macOS 27 measurements show an app-owned panel whose localized accept button must be identified positionally.
    const script =
      macProductMajor >= 27
        ? [
            'on run argv',
            'set startedAt to current date',
            'set deadline to startedAt + 35',
            'set stage to "panel"',
            'set observed to "process or panel unavailable"',
            'try',
            'tell application "System Events"',
            'tell (first application process whose unix id is (item 2 of argv as integer))',
            'set frontmost to true',
            ...[
              {
                stage: 'panel',
                cap: 10,
                action: [],
                condition: '(exists splitter group 1 of window 1)',
                extra: 'if (count of buttons of splitter group 1 of window 1) ≥ 2 then set reached to true',
                detail: 'panel splitter group missing or fewer than two direct buttons'
              },
              {
                stage: 'go-to-folder',
                cap: 5,
                action: ['keystroke "g" using {command down, shift down}'],
                condition: 'exists text field 1 of sheet 1 of window 1',
                detail: 'path text field missing'
              },
              {
                stage: 'path-entry',
                cap: 5,
                action: [
                  'set fallbackAt to (current date) + 2',
                  'set typedFallback to false',
                  'try',
                  'set value of text field 1 of sheet 1 of window 1 to (item 1 of argv)',
                  'end try'
                ],
                condition: '(value of text field 1 of sheet 1 of window 1 as text) equals (item 1 of argv)',
                poll: [
                  'if not typedFallback and (current date) ≥ fallbackAt then',
                  'keystroke "a" using command down',
                  'keystroke (item 1 of argv)',
                  'set typedFallback to true',
                  'end if'
                ],
                detail: 'path readback did not equal requested path'
              },
              {
                stage: 'commit',
                cap: 5,
                action: ['key code 36'],
                condition: 'not (exists sheet 1 of window 1)',
                detail: 'Go to Folder sheet still present'
              },
              {
                stage: 'accept-disabled',
                cap: 5,
                action: [],
                condition: 'enabled of last button of splitter group 1 of window 1',
                detail: 'last direct button is not enabled'
              },
              {
                stage: 'completion',
                cap: 5,
                action: [
                  'set previousWindowCount to count of windows',
                  'click last button of splitter group 1 of window 1'
                ],
                condition: '(count of windows) < previousWindowCount',
                detail: 'panel window count did not decrease'
              }
            ].flatMap(({ stage, cap, action, condition, extra, poll, detail }) => [
              `set stage to "${stage}"`,
              `set observed to "${detail}"`,
              `set stageDeadline to (current date) + ${cap}`,
              'if (current date) ≥ deadline then error observed',
              ...action,
              'set reached to false',
              'repeat',
              'if (current date) ≥ deadline or (current date) ≥ stageDeadline then error observed',
              'try',
              `if ${condition} then`,
              extra ?? 'set reached to true',
              'end if',
              'on error observationError',
              'set observed to observationError',
              'end try',
              'if reached then exit repeat',
              ...(poll ?? []),
              'delay 0.1',
              'end repeat'
            ]),
            'end tell',
            'end tell',
            'on error failureDetail',
            'error "macOS 27 native file panel did not reach stage " & stage & " for pid " & (item 2 of argv) & " after " & ((current date) - startedAt) & "s: " & failureDetail',
            'end try',
            'end run'
          ].join('\n')
        : legacyScript
    try {
      execFileSync('osascript', ['-e', script, '--', filePath, String(electronPid)], {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 45_000
      })
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr
      throw new Error(
        `macOS native file selection failed for pid ${electronPid}: ${String(error)}${stderr ? `\n${String(stderr)}` : ''}`,
        { cause: error }
      )
    }
  } else {
    const isDirectory = statSync(filePath).isDirectory()
    const script = [
      'Set-StrictMode -Version Latest',
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      'Add-Type -AssemblyName System.Windows.Forms',
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeDialog { [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'`,
      '$root = [System.Windows.Automation.AutomationElement]::RootElement',
      `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${electronPid})`,
      '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
      '$dialog = $null',
      'do {',
      '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
      '  $dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" -and -not $_.Current.IsOffscreen -and $_.Current.IsEnabled } | Select-Object -Last 1',
      '  if (-not $dialog) { Start-Sleep -Milliseconds 200 }',
      '} while (-not $dialog -and [DateTime]::UtcNow -lt $deadline)',
      'if (-not $dialog) { throw "Native file dialog was not found" }',
      ...(isDirectory
        ? [
            '$deadline = [DateTime]::UtcNow.AddSeconds(5)',
            '$dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle',
            '$shell = New-Object -ComObject WScript.Shell',
            `$null = $shell.AppActivate(${electronPid})`,
            '$focused = $false',
            'do {',
            '  $null = [NativeDialog]::SetForegroundWindow($dialogHandle)',
            '  $focused = [NativeDialog]::GetForegroundWindow() -eq $dialogHandle',
            '  if (-not $focused) { Start-Sleep -Milliseconds 100 }',
            '} while (-not $focused -and [DateTime]::UtcNow -lt $deadline)',
            'if (-not $focused) { throw "Native folder dialog could not receive focus" }',
            '[System.Windows.Forms.SendKeys]::SendWait("^l")',
            '$addressCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "41477"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $false))',
            '$deadline = [DateTime]::UtcNow.AddSeconds(5)',
            'do {',
            '  $address = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)',
            '  if (-not $address) { Start-Sleep -Milliseconds 100 }',
            '} while (-not $address -and [DateTime]::UtcNow -lt $deadline)',
            'if (-not $address) { throw "Native folder address input was not found" }',
            '$value = $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            `$value.SetValue('${escapePowerShell(filePath)}')`,
            `if ($value.Current.Value -ne '${escapePowerShell(filePath)}') { throw "Native folder address readback mismatch" }`,
            'if ([NativeDialog]::GetForegroundWindow() -ne $dialogHandle) { throw "Native folder dialog lost foreground ownership" }',
            '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
            '$deadline = [DateTime]::UtcNow.AddSeconds(5)',
            'do {',
            '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
            '  $dialog = $windows | Where-Object { [IntPtr]$_.Current.NativeWindowHandle -eq $dialogHandle } | Select-Object -First 1',
            '  if (-not $dialog) { break }',
            '  $editing = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)',
            '  if (-not $editing) { break }',
            '  Start-Sleep -Milliseconds 100',
            '} while ([DateTime]::UtcNow -lt $deadline)',
            'if ($dialog) {',
            '  if ($editing) { throw "Native folder navigation did not finish" }',
            '  $acceptHandle = [NativeDialog]::GetDlgItem([IntPtr]$dialogHandle, 1)',
            '  if ($acceptHandle -eq [IntPtr]::Zero) { throw "Native folder accept button was not found" }',
            '  $null = [NativeDialog]::SendMessage($acceptHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
            '}'
          ]
        : [
            '$shell = New-Object -ComObject WScript.Shell',
            `if (-not $shell.AppActivate(${electronPid})) { throw "Native file dialog could not be activated" }`,
            'Start-Sleep -Milliseconds 300',
            '[System.Windows.Forms.SendKeys]::SendWait("%n")',
            'Start-Sleep -Milliseconds 200',
            `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShell(filePath)}')`,
            '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")'
          ])
    ].join('\n')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30_000
    })
  }
  return filePath
}

export async function cancelNativeFileDialogs(platform: Platform, paths: RunPaths): Promise<void> {
  if (platform !== 'windows') return
  const record = readAppRecord(paths)
  assertOwnedProcess(record, record.electronPid, 'electron')
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeFileDialog { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'`,
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${record.electronPid})`,
    '$dialogCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "#32770")',
    '$fileCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1001"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Edit"))',
    '$cancelCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "2"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Button"))',
    '$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
    '$dialogs = @($windows | Where-Object { $_.Current.ClassName -eq "#32770" })',
    'foreach ($window in $windows) { $dialogs += @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition)) }',
    'foreach ($dialog in $dialogs) {',
    `  if ($dialog.Current.ProcessId -ne ${record.electronPid}) { continue }`,
    '  if (-not $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileCondition)) { continue }',
    '  $cancel = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cancelCondition)',
    '  if ($cancel -and $cancel.Current.NativeWindowHandle) { $null = [NativeFileDialog]::SendMessage([IntPtr]$cancel.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }',
    '}'
  ].join('\n')
  await runAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    15_000
  )
}

export async function saveNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): Promise<string> {
  const filePath = resolveAllowedPath(candidatePath, [paths.evidence])
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const record = readAppRecord(paths)
  const electronPid = record.electronPid
  assertOwnedProcess(record, electronPid, 'electron')
  if (platform === 'macos') {
    macProductMajor ??= Number.parseInt(
      execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5_000 }).trim(),
      10
    )
    if (!Number.isInteger(macProductMajor)) throw new Error('Could not determine macOS product version')
    const script = [
      'on run argv',
      'tell application "System Events"',
      'tell (first application process whose unix id is (item 3 of argv as integer))',
      'set frontmost to true',
      ...(macProductMajor >= 27
        ? [
            'set deadline to (current date) + 50',
            'repeat',
            'try',
            'set saveWindowName to name of (first window whose subrole is "AXStandardWindow")',
            'exit repeat',
            'end try',
            'if (current date) > deadline then error "Native save window was not found"',
            'delay 0.1',
            'end repeat',
            'repeat until exists splitter group 1 of sheet 1 of window saveWindowName',
            'if (current date) > deadline then error "Native save panel was not found"',
            'delay 0.1',
            'end repeat',
            'keystroke "g" using {command down, shift down}',
            'repeat until exists text field 1 of sheet 1 of sheet 1 of window saveWindowName',
            'if (current date) > deadline then error "Save directory input was not found"',
            'delay 0.1',
            'end repeat',
            'click text field 1 of sheet 1 of sheet 1 of window saveWindowName',
            'keystroke "a" using command down',
            'keystroke (item 1 of argv)',
            'delay 0.3',
            'key code 36',
            'repeat while exists sheet 1 of sheet 1 of window saveWindowName',
            'if (current date) > deadline then error "Save directory navigation did not finish"',
            'delay 0.3',
            'if exists text field 1 of sheet 1 of sheet 1 of window saveWindowName then key code 36',
            'end repeat',
            'repeat',
            'try',
            'if exists text field 2 of splitter group 1 of sheet 1 of window saveWindowName then exit repeat',
            'end try',
            'if (current date) > deadline then error "Save filename input was not found"',
            'delay 0.1',
            'end repeat',
            'click text field 2 of splitter group 1 of sheet 1 of window saveWindowName',
            'keystroke "a" using command down',
            'keystroke (item 2 of argv)',
            'repeat',
            'tell application "System Events" to set saved to exists disk item (item 4 of argv)',
            'if saved then exit repeat',
            'if (current date) > deadline then error "Native save did not finish"',
            'set frontmost to true',
            'try',
            'if exists sheet 1 of window saveWindowName then',
            'if enabled of last button of splitter group 1 of sheet 1 of window saveWindowName then',
            'click last button of splitter group 1 of sheet 1 of window saveWindowName',
            'else',
            'key code 36',
            'end if',
            'end if',
            'end try',
            'delay 0.3',
            'end repeat'
          ]
        : [
            'delay 2',
            'keystroke "g" using {command down, shift down}',
            'delay 1',
            'keystroke (item 1 of argv)',
            'key code 36',
            'delay 1',
            'keystroke "a" using command down',
            'keystroke (item 2 of argv)',
            'key code 36'
          ]),
      'end tell',
      'end tell',
      'end run'
    ].join('\n')
    const extension = extname(filePath)
    const saveName = macProductMajor >= 27 || !extension ? basename(filePath) : basename(filePath, extension)
    await runAsync('osascript', ['-e', script, '--', directory, saveName, String(electronPid), filePath], 55_000)
  } else {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class NativeSaveDialog { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window); [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)] public static extern IntPtr SetText(IntPtr window, uint message, IntPtr wParam, string text); [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)] public static extern IntPtr ReadText(IntPtr window, uint message, IntPtr wParam, StringBuilder text); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'`,
      '$root = [System.Windows.Automation.AutomationElement]::RootElement',
      `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${electronPid})`,
      '$fileCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1001"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Edit"))',
      '$dialogCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "#32770")',
      '$deadline = [DateTime]::UtcNow.AddSeconds(60)',
      '$dialog = $null',
      'do {',
      '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
      '  $dialogs = @($windows | Where-Object { $_.Current.ClassName -eq "#32770" })',
      '  foreach ($window in $windows) { $dialogs += @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition)) }',
      `  $dialog = $dialogs | Where-Object { $_.Current.ProcessId -eq ${electronPid} -and $_.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileCondition) } | Select-Object -Last 1`,
      '  if (-not $dialog) { Start-Sleep -Milliseconds 200 }',
      '} while (-not $dialog -and [DateTime]::UtcNow -lt $deadline)',
      'if (-not $dialog) { throw "Native save dialog was not found" }',
      '$null = [NativeSaveDialog]::SetForegroundWindow([IntPtr]$dialog.Current.NativeWindowHandle)',
      '$filenameControl = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileCondition)',
      '$buttonCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Button"))',
      '$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)',
      'if (-not $filenameControl.Current.NativeWindowHandle -or -not $button -or -not $button.Current.NativeWindowHandle) { throw "Native save controls are unavailable" }',
      `$filePath = '${escapePowerShell(filePath)}'`,
      'if ([NativeSaveDialog]::SetText([IntPtr]$filenameControl.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $filePath) -eq [IntPtr]::Zero) { throw "Native save filename could not be set" }',
      '$readback = [System.Text.StringBuilder]::new(32768)',
      '$null = [NativeSaveDialog]::ReadText([IntPtr]$filenameControl.Current.NativeWindowHandle, 0x000D, [IntPtr]$readback.Capacity, $readback)',
      'if ($readback.ToString() -cne $filePath) { throw "Native save filename does not match the requested path" }',
      '$null = [NativeSaveDialog]::SendMessage([IntPtr]$button.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)'
    ].join('\n')
    await runAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      65_000
    )
  }
  return filePath
}
