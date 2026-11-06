import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { cleanupExternalResources, observeExternalResource, registerExternalResource } from './externalResources'
import { readAppRecord, readOwnedRecord } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import { assertOwnedProcess, findCdpPid, isDescendant } from './process'
import type { Platform } from './types'

const ALLOWED_KEYS = new Set(['Alt', 'Control', 'Enter', 'Escape', 'Meta', 'Shift', 'Space', 'a', 'c', 'e', 'k', 's'])
let activeTextResource: { paths: RunPaths; id: string; platform: Platform } | undefined
let activeWindowsTextFixturePid: number | undefined
let activeMacTextFixturePath: string | undefined
let macProductMajor: number | undefined

export function openMacTrayMenu(paths: RunPaths): void {
  const record = readAppRecord(paths)
  if (record.platform !== 'macos') throw new Error('Native tray automation requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  execFileSync(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `
    ObjC.import('CoreGraphics')
    ObjC.import('Foundation')
    const process = Application('System Events').processes.whose({unixId: ${record.electronPid}})[0]
    const item = process.menuBars[1].menuBarItems[0]
    const position = item.position(), size = item.size()
    const point = {x: position[0] + size[0] / 2, y: position[1] + size[1] / 2}
    $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 5, point, 0))
    $.NSThread.sleepForTimeInterval(0.15)
    $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 3, point, 1))
    $.NSThread.sleepForTimeInterval(0.15)
    $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 4, point, 1))
  `
    ],
    { timeout: 10_000, stdio: 'ignore' }
  )
}

export function dragMacPointer(paths: RunPaths, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const record = readAppRecord(paths)
  if (record.platform !== 'macos') throw new Error('Native pointer dragging requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) throw new Error('Pointer coordinates must be finite')
  execFileSync(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `
    ObjC.import('CoreGraphics')
    ObjC.import('Foundation')
    const from = ${JSON.stringify(from)}, to = ${JSON.stringify(to)}
    const post = (type, point) => $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, point, 0))
    post(5, from)
    $.NSThread.sleepForTimeInterval(0.1)
    post(1, from)
    try {
      for (let step = 1; step <= 15; step++) {
        post(6, {x: from.x + (to.x - from.x) * step / 15, y: from.y + (to.y - from.y) * step / 15})
        $.NSThread.sleepForTimeInterval(0.016)
      }
    } finally {
      post(2, to)
    }
  `
    ],
    { timeout: 10_000, stdio: 'ignore' }
  )
}

export function closeMacComputerUsePermissionGuide(paths: RunPaths): boolean {
  const record = readAppRecord(paths)
  if (record.platform !== 'macos') throw new Error('Native permission automation requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  // LaunchServices reparents SDK agents; their final argument identifies the owned protocol process.
  const agents = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) =>
      line.trim().match(/^(\d+) (.*Cherry Computer Use\.app\/Contents\/MacOS\/.*) __computer-use-sdk-agent .+ (\d+)$/)
    )
    .filter((match): match is RegExpMatchArray =>
      Boolean(match && isDescendant(Number(match[3]), record.electronPid, 'macos'))
    )
  if (agents.length !== 1) return false
  const pid = Number(agents[0][1])
  const script = `
    import ApplicationServices
    import Foundation
    func closeGuide(_ pid: Int32) -> Bool {
      var value: CFTypeRef?
      let application = AXUIElementCreateApplication(pid)
      guard AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &value) == .success,
            let windows = value as? [AXUIElement] else { return false }
      for window in windows {
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title)
        guard title as? String == "Cherry Computer Use" else { continue }
        var close: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXCloseButtonAttribute as CFString, &close) == .success,
              let close, CFGetTypeID(close) == AXUIElementGetTypeID() else { continue }
        return AXUIElementPerformAction(unsafeBitCast(close, to: AXUIElement.self), kAXPressAction as CFString) == .success
      }
      return false
    }
    print(closeGuide(${pid}))
  `
  return (
    execFileSync('swift', ['-module-cache-path', join(paths.private, 'swift-module-cache'), '-e', script], {
      encoding: 'utf8',
      timeout: 30_000
    }).trim() === 'true'
  )
}

export function setMacNotificationCenterOpen(paths: RunPaths, open: boolean): void {
  const record = readAppRecord(paths)
  if (record.platform !== 'macos') throw new Error('Native notification automation requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  execFileSync(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `
    ObjC.import('CoreGraphics')
    ObjC.import('Foundation')
    const center = Application('System Events').processes.byName('NotificationCenter')
    const containsEditor = (element, depth) => {
      try {
        if (element.attributes.byName('AXIdentifier').value() === 'widget-editor-button') return true
      } catch {}
      return depth < 5 && element.uiElements().some(child => containsEditor(child, depth + 1))
    }
    const open = center.windows().some(window => containsEditor(window, 0))
    if (open !== ${JSON.stringify(open)}) {
      for (const down of [true, false]) {
        const event = $.CGEventCreateKeyboardEvent(null, 45, down)
        $.CGEventSetFlags(event, 8388608)
        $.CGEventPost(0, event)
        $.NSThread.sleepForTimeInterval(0.1)
      }
    }
  `
    ],
    { timeout: 10_000, stdio: 'ignore' }
  )
}

export function findMacNotification(paths: RunPaths, text: string, click = false): boolean {
  const record = readAppRecord(paths)
  if (record.platform !== 'macos') throw new Error('Native notification automation requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const script = `on run argv
    tell application "System Events" to tell process "NotificationCenter"
      try
        repeat with windowIndex from 1 to count of windows
          set windowElements to entire contents of window windowIndex
          repeat with elementReference in windowElements
            set element to contents of elementReference
            if role of element is "AXStaticText" then
              if (value of element as text) contains item 1 of argv then
                if item 2 of argv is not "click" then return "found"
                set notificationGroup to value of attribute "AXParent" of element
                repeat 8 times
                  if (name of every action of notificationGroup) contains "AXPress" then
                    perform action "AXPress" of notificationGroup
                    return "found"
                  end if
                  set notificationGroup to value of attribute "AXParent" of notificationGroup
                end repeat
              end if
            end if
          end repeat
        end repeat
      on error errorMessage number errorNumber
        if errorNumber is not -1728 then error errorMessage number errorNumber
      end try
    end tell
    return "absent"
  end run`
  return (
    execFileSync('osascript', ['-e', script, '--', text, click ? 'click' : 'read'], {
      encoding: 'utf8',
      timeout: 10_000
    }).trim() === 'found'
  )
}

export function findWindowsNotification(paths: RunPaths, text: string, click = false): boolean {
  const record = readAppRecord(paths)
  if (record.platform !== 'windows') throw new Error('Native Windows notifications require Windows')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    '$root = [Windows.Automation.AutomationElement]::RootElement',
    `$text = '${escapePowerShell(text)}'`,
    '$textCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Text)',
    '$match = $null',
    'foreach ($hostProcess in @(Get-Process -Name ShellExperienceHost -ErrorAction SilentlyContinue)) {',
    '  $processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $hostProcess.Id)',
    '  foreach ($window in $root.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)) {',
    '    $match = @($window.FindAll([Windows.Automation.TreeScope]::Descendants, $textCondition) | Where-Object { $_.Current.Name.Contains($text) }) | Select-Object -First 1',
    '    if ($match) { break }',
    '  }',
    '  if ($match) { break }',
    '}',
    'if (-not $match) { Write-Output "absent"; exit }',
    ...(click
      ? [
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ToastMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra); }'`,
          '$bounds = $match.Current.BoundingRectangle',
          'if ($match.Current.IsOffscreen -or $bounds.Width -le 0 -or $bounds.Height -le 0) { throw "The matching notification is not visible" }',
          'if (-not [ToastMouse]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2))) { throw "Could not reach the matching notification" }',
          '[ToastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
          '[ToastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)'
        ]
      : []),
    'Write-Output "found"'
  ].join('\n')
  return (
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000
    }).trim() === 'found'
  )
}

export function closeExternalText(platform: Platform): void {
  if (!activeTextResource || activeTextResource.platform !== platform) return
  cleanupExternalResources(activeTextResource.paths, [activeTextResource.id])
  activeTextResource = undefined
  activeWindowsTextFixturePid = undefined
  activeMacTextFixturePath = undefined
}

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
  const press = `${action}${modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : ''}`
  // While an external text viewer is open it owns the selection, but the app window can steal
  // frontmost back; re-activate the viewer in the same script so the keystroke lands on it.
  const script = activeMacTextFixturePath
    ? [
        'tell application "TextEdit" to activate',
        'delay 0.5',
        'tell application "System Events"',
        'tell process "TextEdit" to set frontmost to true',
        'delay 0.3',
        press,
        'end tell'
      ].join('\n')
    : `tell application "System Events" to ${press}`
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
 * requested button from the desktop instead. Resolves once the box is gone.
 */
export async function dismissNativeMessageBox(
  platform: Platform,
  paths: RunPaths,
  title: string,
  buttonName = 'OK'
): Promise<void> {
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
      'set buttonName to item 3 of argv',
      'tell application "System Events"',
      'repeat 240 times',
      'try',
      'if exists (first application process whose unix id is targetPid) then',
      'tell (first application process whose unix id is targetPid)',
      'repeat with w in windows',
      'if exists button buttonName of w then',
      'click button buttonName of w',
      'return "window"',
      'end if',
      'if (count of sheets of w) > 0 then',
      'repeat with s in sheets of w',
      'if exists button buttonName of s then',
      'click button buttonName of s',
      'return "sheet"',
      'end if',
      'end repeat',
      'end if',
      'end repeat',
      'end tell',
      'end if',
      'on error errorMessage number errorNumber',
      'if errorNumber is not -1719 and errorNumber is not -1728 then error errorMessage number errorNumber',
      'end try',
      'delay 0.25',
      'end repeat',
      'error "Native message box was not found"',
      'end tell',
      'end run'
    ].join('\n')
    return runAsync('osascript', ['-e', script, '--', title, String(electronPid), buttonName], 90_000)
  }
  const script = [
    'Set-StrictMode -Version Latest',
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
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
    `$buttonCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '${escapePowerShell(buttonName)}'))`,
    '$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)',
    'if (-not $button) { throw "Native message box confirmation button was not found" }',
    '([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()',
    'Start-Sleep -Milliseconds 500'
  ].join('\n')
  return runAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    90_000
  )
}

export function openExternalText(platform: Platform, paths: RunPaths, candidatePath: string): string {
  const filePath = resolveAllowedPath(candidatePath, [paths.fixtures, paths.evidence])
  if (!existsSync(filePath)) throw new Error(`External text fixture does not exist: ${filePath}`)
  closeExternalText(platform)
  const id = registerExternalResource(paths, platform, {
    kind: 'document',
    application: platform === 'macos' ? 'TextEdit' : 'Notepad',
    path: filePath
  })
  activeTextResource = { paths, id, platform }
  if (platform === 'macos') {
    activeMacTextFixturePath = filePath
    execFileSync('open', ['-a', 'TextEdit', filePath], { stdio: 'ignore', timeout: 10_000 })
    execFileSync(
      'osascript',
      [
        '-e',
        'tell application "System Events" to tell process "TextEdit" to set frontmost to true',
        '-e',
        'delay 1',
        '-e',
        'tell application "System Events" to keystroke "a" using command down'
      ],
      { stdio: 'ignore', timeout: 10_000 }
    )
  } else {
    const script = [
      `$fixture = Start-Process -FilePath notepad.exe -ArgumentList '"${escapePowerShell(filePath)}"' -PassThru`,
      '$deadline = [DateTime]::UtcNow.AddSeconds(20)',
      'do {',
      '  $fixture.Refresh()',
      '  if ($fixture.HasExited) { throw "External editor exited before opening the file" }',
      '  if ($fixture.MainWindowHandle -eq 0) { Start-Sleep -Milliseconds 200 }',
      '} while ($fixture.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline)',
      'if ($fixture.MainWindowHandle -eq 0) { throw "External editor window was not found" }',
      '$shell = New-Object -ComObject WScript.Shell',
      'if (-not $shell.AppActivate($fixture.Id)) { throw "External editor could not be activated" }',
      'Start-Sleep -Milliseconds 500',
      '$shell.SendKeys("^a")',
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
  observeExternalResource(paths, id)
  return filePath
}

export function readWindowsExternalText(): {
  text: string
  selectedText: string
  bounds: { x: number; y: number; width: number; height: number }
} {
  if (!activeWindowsTextFixturePid || activeTextResource?.platform !== 'windows') {
    throw new Error('No owned Windows external text editor is open')
  }
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    `$condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${activeWindowsTextFixturePid})`,
    '$window = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)',
    'if (-not $window) { throw "Owned external text window is unavailable" }',
    '$editorCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)',
    '$editor = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $editorCondition)',
    'if (-not $editor) { throw "Owned external editor has no text control" }',
    '$text = $editor.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern)',
    '$bounds = $window.Current.BoundingRectangle',
    '@{ text = $text.DocumentRange.GetText(-1); selectedText = (($text.GetSelection() | ForEach-Object { $_.GetText(-1) }) -join ""); bounds = @{ x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height } } | ConvertTo-Json -Compress'
  ].join('; ')
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000
    })
  )
}

export async function inspectImageInExternalBrowser(
  paths: RunPaths,
  candidatePath: string
): Promise<{ width: number; height: number; screenshot: string }> {
  const filePath = resolveAllowedPath(candidatePath, [paths.evidence])
  const resource = registerExternalResource(paths, 'windows', { kind: 'browser', title: basename(filePath) })
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
    observeExternalResource(paths, resource)
    return { ...dimensions, screenshot }
  } finally {
    await browser.close()
  }
}

export function readWindowsPrintDialog(paths: RunPaths): string[] {
  const record = readAppRecord(paths)
  if (record.platform !== 'windows') throw new Error('Native Windows print inspection requires Windows')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    `$condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${record.electronPid})`,
    '$windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)',
    '$dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" -and $_.Current.Name -eq "Print" } | Select-Object -First 1',
    'if (-not $dialog) { Write-Output "[]"; exit }',
    '$names = @($dialog.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ })',
    'ConvertTo-Json -InputObject $names -Compress'
  ].join('; ')
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000
    })
  )
}

export function chooseNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): string {
  return chooseNativeSelection(platform, paths, candidatePath)
}

export function chooseWindowsNativeFiles(paths: RunPaths, candidates: string[]): void {
  if (candidates.length === 0) throw new Error('Native multi-file selection requires at least one file')
  const files = candidates.map((candidate) => {
    const file = resolveAllowedPath(candidate, [paths.fixtures, paths.workspace, paths.evidence])
    if (!statSync(file).isFile()) throw new Error(`Selected path is not a file: ${file}`)
    return file
  })
  chooseNativeSelection('windows', paths, files[0], files.map((file) => `"${file}"`).join(' '))
}

function chooseNativeSelection(
  platform: Platform,
  paths: RunPaths,
  candidatePath: string,
  selectionText?: string
): string {
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
      `Add-Type -TypeDefinition '
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeDialog {
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr SetText(IntPtr window, uint message, IntPtr wParam, string value);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr ReadText(IntPtr window, uint message, IntPtr wParam, StringBuilder value);
}'`,
      '$root = [System.Windows.Automation.AutomationElement]::RootElement',
      `$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${electronPid})`,
      '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
      '$dialog = $null',
      'do {',
      '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
      '  $dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" -and -not $_.Current.IsOffscreen -and $_.Current.IsEnabled } | Select-Object -Last 1',
      '  if (-not $dialog) { Start-Sleep -Milliseconds 200 }',
      '} while (-not $dialog -and [DateTime]::UtcNow -lt $deadline)',
      'if (-not $dialog) {',
      '  $dialog = $windows | Where-Object { $_.Current.ClassName -eq "#32770" -and -not $_.Current.IsOffscreen } | Select-Object -Last 1',
      '}',
      'if (-not $dialog) {',
      '  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
      '  $seen = ($all | Select-Object -First 25 | ForEach-Object { "$($_.Current.ProcessId)|$($_.Current.ClassName)|$($_.Current.ControlType.ProgrammaticName)|offscreen=$($_.Current.IsOffscreen)|$($_.Current.Name)" }) -join " ; "',
      '  throw ("Native file dialog was not found for pid ' + electronPid + '. Top-level windows: " + $seen)',
      '}',
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
            '[NativeDialog]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)',
            '[NativeDialog]::keybd_event(0x4C, 0, 0, [UIntPtr]::Zero)',
            '[NativeDialog]::keybd_event(0x4C, 0, 2, [UIntPtr]::Zero)',
            '[NativeDialog]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)',
            '$addressCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "41477"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $false))',
            '$addressCondition = [System.Windows.Automation.AndCondition]::new($addressCondition, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Edit"))',
            '$deadline = [DateTime]::UtcNow.AddSeconds(5)',
            'do {',
            '  $address = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)',
            '  if ($address -and -not [NativeDialog]::IsWindowVisible([IntPtr]$address.Current.NativeWindowHandle)) { $address = $null }',
            '  if (-not $address) { Start-Sleep -Milliseconds 100 }',
            '} while (-not $address -and [DateTime]::UtcNow -lt $deadline)',
            'if (-not $address) { throw "Native folder address input was not found" }',
            '$addressHandle = [IntPtr]$address.Current.NativeWindowHandle',
            `$null = [NativeDialog]::SetText($addressHandle, 0x000C, [IntPtr]::Zero, '${escapePowerShell(filePath)}')`,
            '$value = [System.Text.StringBuilder]::new(32768)',
            '$null = [NativeDialog]::ReadText($addressHandle, 0x000D, [IntPtr]::new($value.Capacity), $value)',
            `if ($value.ToString() -ne '${escapePowerShell(filePath)}') { throw "Native folder address readback mismatch" }`,
            'if ([NativeDialog]::GetForegroundWindow() -ne $dialogHandle) { throw "Native folder dialog lost foreground ownership" }',
            '[NativeDialog]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)',
            '[NativeDialog]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)',
            '$deadline = [DateTime]::UtcNow.AddSeconds(5)',
            'do {',
            '  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
            '  $dialog = $windows | Where-Object { [IntPtr]$_.Current.NativeWindowHandle -eq $dialogHandle } | Select-Object -First 1',
            '  if (-not $dialog) { break }',
            '  $editing = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)',
            '  if ($editing -and -not [NativeDialog]::IsWindowVisible([IntPtr]$editing.Current.NativeWindowHandle)) { $editing = $null }',
            '  if (-not $editing) { break }',
            '  Start-Sleep -Milliseconds 100',
            '} while ([DateTime]::UtcNow -lt $deadline)',
            'if ($dialog) {',
            '  if ($editing) { throw "Native folder navigation did not finish" }',
            '  $accept = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Button")))',
            '  if (-not $accept) { throw "Native folder accept button was not found" }',
            '  $invoke = $null',
            '  if ($accept.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() } else {',
            '    $handle = [IntPtr]$accept.Current.NativeWindowHandle',
            '    if ($handle -eq [IntPtr]::Zero) { throw "Native accept button has no window handle" }',
            '    $null = [NativeDialog]::SendMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
            '  }',
            '}'
          ]
        : [
            // Use the native controls' automation patterns so the common dialog receives change/accept events.
            '$dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle',
            '$fileCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1001"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Edit"))',
            '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
            '$fileInput = $null',
            'do {',
            '  $fileInput = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileCondition)',
            '  if (-not $fileInput) { Start-Sleep -Milliseconds 200 }',
            '} while (-not $fileInput -and [DateTime]::UtcNow -lt $deadline)',
            'if (-not $fileInput) {',
            '  $editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)',
            '  $fileInput = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition) | Where-Object { -not $_.Current.IsOffscreen } | Select-Object -Last 1',
            '}',
            'if (-not $fileInput) {',
            '  $all = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
            '  $seen = ($all | Select-Object -First 40 | ForEach-Object { "$($_.Current.AutomationId)|$($_.Current.ClassName)|$($_.Current.ControlType.ProgrammaticName)|offscreen=$($_.Current.IsOffscreen)|$($_.Current.Name)" }) -join " ; "',
            '  throw ("Native file name input was not found. Dialog descendants: " + $seen)',
            '}',
            `$requested = '${escapePowerShell(selectionText ?? filePath)}'`,
            '$valuePattern = $null',
            'try { $valuePattern = [System.Windows.Automation.ValuePattern]$fileInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { $valuePattern = $null }',
            'if ($valuePattern) {',
            '  $valuePattern.SetValue($requested)',
            '} else {',
            '  $null = [NativeDialog]::SetText([IntPtr]$fileInput.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $requested)',
            '}',
            '$current = $null',
            'if ($valuePattern) { $current = $valuePattern.Current.Value } else {',
            '  $buffer = [System.Text.StringBuilder]::new(32768)',
            '  $null = [NativeDialog]::ReadText([IntPtr]$fileInput.Current.NativeWindowHandle, 0x000D, [IntPtr]::new($buffer.Capacity), $buffer)',
            '  $current = $buffer.ToString()',
            '}',
            'if ($current -ne $requested) { throw "Native file name readback mismatch" }',
            '$null = [NativeDialog]::SetForegroundWindow($dialogHandle)',
            '$accept = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1"), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Button")))',
            'if (-not $accept) { throw "Native file dialog accept button was not found" }',
            '$invoke = $null',
            'if ($accept.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() } else {',
            '  $handle = [IntPtr]$accept.Current.NativeWindowHandle',
            '  if ($handle -eq [IntPtr]::Zero) { throw "Native accept button has no window handle" }',
            '  $null = [NativeDialog]::SendMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
            '}',
            '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
            '$closed = $false',
            'do {',
            '  $remaining = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)',
            '  $closed = -not ($remaining | Where-Object { [IntPtr]$_.Current.NativeWindowHandle -eq $dialogHandle })',
            '  if (-not $closed) { Start-Sleep -Milliseconds 100 }',
            '} while (-not $closed -and [DateTime]::UtcNow -lt $deadline)',
            'if (-not $closed) { throw "Native file dialog did not close after accepting the file name" }'
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

export type NativeSaveOutcome = { filePath: string; suggestedName: string }

export async function saveNativeFile(platform: Platform, paths: RunPaths, candidatePath: string): Promise<string> {
  const outcome = await saveNativeFileKeepingName(platform, paths, candidatePath)
  return outcome.filePath
}

/**
 * Drive the native save panel for `candidatePath` and report the file name the application proposed.
 * `keepSuggestedName` accepts that name unchanged, so a caller can assert what the product offered
 * instead of guessing it; the file that actually appears in the directory is then returned.
 */
export async function saveNativeFileKeepingName(
  platform: Platform,
  paths: RunPaths,
  candidatePath: string,
  keepSuggestedName = false
): Promise<NativeSaveOutcome> {
  // `private` holds credential-bearing artifacts that are never uploaded, so unredacted saves stay there.
  const filePath = resolveAllowedPath(candidatePath, [paths.evidence, paths.private])
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const record = readAppRecord(paths)
  const electronPid = record.electronPid
  assertOwnedProcess(record, electronPid, 'electron')
  if (platform !== 'macos') {
    return saveNativeFileWindows(filePath, electronPid, keepSuggestedName)
  }

  macProductMajor ??= Number.parseInt(
    execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5_000 }).trim(),
    10
  )
  if (!Number.isInteger(macProductMajor)) throw new Error('Could not determine macOS product version')
  const existingNames = new Set(readdirSync(directory))
  const extension = extname(filePath)
  const saveName = macProductMajor >= 27 || !extension ? basename(filePath) : basename(filePath, extension)
  // macOS 27 is app-owned and refuses `entire contents` walks, so the panel is driven by keystrokes only:
  // Go to Folder takes the destination, then either the suggested name is accepted or ours is typed.
  const acceptScript = () =>
    [
      'on run argv',
      'set directoryPath to item 1 of argv',
      'set keepName to item 2 of argv',
      'set fileName to item 3 of argv',
      'set pidArg to item 4 of argv as integer',
      'tell application "System Events"',
      'tell (first application process whose unix id is pidArg)',
      'set frontmost to true',
      'delay 2',
      'keystroke "g" using {command down, shift down}',
      'delay 2',
      'keystroke directoryPath',
      'delay 1',
      'key code 36',
      'delay 2',
      'if keepName is "no" then',
      'keystroke "a" using command down',
      'delay 0.2',
      'keystroke fileName',
      'delay 0.3',
      'key code 36',
      'else',
      'key code 36',
      'end if',
      'end tell',
      'end tell',
      'end run'
    ].join('\n')

  const createdSince = () => {
    if (!keepSuggestedName) return existsSync(filePath) ? [filePath] : []
    return readdirSync(directory)
      .filter((name) => !existingNames.has(name) && !name.startsWith('.'))
      .map((name) => join(directory, name))
  }

  // The app owns the panel, so keystroke timing through the window server is not deterministic:
  // retry the whole sequence once (dismissing any half-open sheet first) before calling it a failure.
  const firstAttemptDeadline = Date.now() + 12_000
  const overallDeadline = Date.now() + 40_000
  let attempt = 0
  await runAsync(
    'osascript',
    ['-e', acceptScript(), '--', directory, keepSuggestedName ? 'yes' : 'no', saveName, String(electronPid)],
    45_000
  ).catch(() => undefined)
  let created = createdSince()
  while (created.length === 0 && Date.now() < overallDeadline) {
    if (attempt === 0 && Date.now() > firstAttemptDeadline) {
      attempt = 1
      await runAsync(
        'osascript',
        [
          '-e',
          `tell application "System Events" to tell (first application process whose unix id is ${electronPid}) to key code 53`
        ],
        10_000
      ).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await runAsync(
        'osascript',
        ['-e', acceptScript(), '--', directory, keepSuggestedName ? 'yes' : 'no', saveName, String(electronPid)],
        45_000
      ).catch(() => undefined)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    created = createdSince()
  }
  if (created.length > 0) {
    const savedPath = keepSuggestedName ? newestFile(created) : filePath
    return { filePath: savedPath, suggestedName: keepSuggestedName ? basename(savedPath) : basename(filePath) }
  }
  throw new Error(
    keepSuggestedName
      ? `Native save panel did not write a file with its suggested name into ${directory}`
      : `Native save panel did not create ${filePath}`
  )
}

function newestFile(candidates: string[]): string {
  return candidates
    .map((file) => ({ file, modified: statSync(file).mtimeMs }))
    .sort((left, right) => right.modified - left.modified)[0].file
}

async function saveNativeFileWindows(
  filePath: string,
  electronPid: number,
  keepSuggestedName: boolean
): Promise<NativeSaveOutcome> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    'try {',
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
    '$initial = [System.Text.StringBuilder]::new(32768)',
    '$null = [NativeSaveDialog]::ReadText([IntPtr]$filenameControl.Current.NativeWindowHandle, 0x000D, [IntPtr]$initial.Capacity, $initial)',
    'if (-not $initial.ToString()) { throw "Native save dialog proposed no file name" }',
    `$filePath = '${escapePowerShell(filePath)}'`,
    `$keepName = $${keepSuggestedName ? 'true' : 'false'}`,
    '$directory = Split-Path -Parent $filePath',
    '$target = if ($keepName) { Join-Path $directory ($initial.ToString()) } else { $filePath }',
    '$valuePattern = $null',
    'if ($filenameControl.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {',
    '  $valuePattern.SetValue($target)',
    '} else {',
    '  $null = [NativeSaveDialog]::SetText([IntPtr]$filenameControl.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $target)',
    '}',
    '$readback = [System.Text.StringBuilder]::new(32768)',
    '$null = [NativeSaveDialog]::ReadText([IntPtr]$filenameControl.Current.NativeWindowHandle, 0x000D, [IntPtr]$readback.Capacity, $readback)',
    'if ($readback.ToString() -cne $target) { throw "Native save filename does not match the requested path" }',
    '$dialogHandle = $dialog.Current.NativeWindowHandle',
    '$invoke = $null',
    'if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {',
    '  $invoke.Invoke()',
    '} else {',
    '  $null = [NativeSaveDialog]::SendMessage([IntPtr]$button.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)',
    '}',
    // The dialog is asynchronous: wait for the file the dialog actually wrote. The window may append
    // the extension from the application's filter, so accept the proposed name with or without one.
    '$base = [IO.Path]::GetFileName($target)',
    '$clickedAt = [DateTime]::UtcNow',
    '$notes = @()',
    '$written = $null',
    '$writeDeadline = [DateTime]::UtcNow.AddSeconds(30)',
    'while (-not $written -and [DateTime]::UtcNow -lt $writeDeadline) {',
    '  $candidates = @(Get-ChildItem -LiteralPath $directory -ErrorAction SilentlyContinue | Where-Object { ($_.Name -eq $base -or $_.Name.StartsWith($base + ".")) -and $_.LastWriteTime.ToUniversalTime() -ge $clickedAt.AddSeconds(-2) })',
    '  if ($candidates.Count -gt 0) { $written = ($candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName; break }',
    '  $others = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition) | Where-Object { $_.Current.ClassName -eq "#32770" -and $_.Current.NativeWindowHandle -ne $dialogHandle })',
    '  foreach ($prompt in $others) {',
    '    if ($prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fileCondition)) { continue }',
    '    $textCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)',
    '    $text = @($prompt.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition) | ForEach-Object { $_.Current.Name }) -join " "',
    '    $notes += ("prompt " + $prompt.Current.Name + ": " + $text)',
    '    $answer = $prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "6"))',
    '    if (-not $answer) { $answer = $prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "1")) }',
    '    if ($answer -and $answer.Current.NativeWindowHandle) { $null = [NativeSaveDialog]::SendMessage([IntPtr]$answer.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }',
    '  }',
    '  Start-Sleep -Milliseconds 250',
    '}',
    'if (-not $written) {',
    '  $open = @()',
    '  $files = @()',
    '  try { $open = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition) | ForEach-Object { $_.Current.ClassName + ":" + $_.Current.Name }) } catch { $open = @("unavailable") }',
    '  try { $files = @(Get-ChildItem -LiteralPath $directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) } catch { $files = @("unavailable") }',
    `  throw ("Native save dialog did not write {0}. Windows: {1}. Prompts: {2}. Directory: {3}" -f $target, ($open -join " ; "), ($notes -join " ; "), ($files -join ", "))`,
    '}',
    'Write-Output $written',
    '} catch {',
    '  Write-Output ("ERROR: " + $_.Exception.Message)',
    '}'
  ].join('\n')
  const output = await runAsyncCapture(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    125_000
  )
  // PowerShell writes thrown messages to the CLIXML error stream, which is unreadable in CI logs.
  // The script reports them on stdout instead so a failing run names the step that failed.
  const reported = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('ERROR: '))
  if (reported) throw new Error(`Native save dialog failed: ${reported.slice('ERROR: '.length)}`)
  const savedPath = output.trim()
  const resolved = savedPath.length > 0 ? savedPath : filePath
  return { filePath: resolved, suggestedName: basename(resolved) }
}

function runAsyncCapture(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) =>
      error
        ? reject(new Error(`${file} exited with ${error.code ?? 'error'}: ${decodePowerShellError(stderr)}`))
        : resolve(stdout ?? '')
    )
  })
}

function decodePowerShellError(stderr: string): string {
  const text = (stderr ?? '')
    .replace(/^#<\s*CLIXML\s*/m, '')
    .replace(/<[^>]+>/g, '')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 ? text : '(no stderr)'
}
