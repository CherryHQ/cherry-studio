import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRunDirectories, getRunPaths } from '../paths'
import { CDP_PORT, isAlive, processCommand } from '../process'
import {
  chooseNativeFile,
  chooseNativeFiles,
  dismissNativeMessageBox,
  readWindowsPrintDialog,
  saveNativeFile,
  saveNativeFileKeepingName,
  setMacNotificationCenterOpen,
  setWindowsNotificationCenterOpen
} from '../systemAutomation'
import { readWindowsFileOwners } from '../windowsFileOwners'
import { listWindowsCodeTerminals, windowsTerminalText } from '../windowsTerminal'

it('rejects file-owner inspection outside the isolated profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-native-owners-'))
  try {
    expect(() => readWindowsFileOwners(getRunPaths(directory), join(directory, 'outside.db'))).toThrow(
      'outside the regression test directories'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'win32')('reports the real owner only while its file handle is open', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-native-owners-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const file = join(paths.profiles, 'owned.db')
  try {
    const handle = openSync(file, 'w+')
    try {
      expect(readWindowsFileOwners(paths, file)).toContain(process.pid)
    } finally {
      closeSync(handle)
    }
    expect(readWindowsFileOwners(paths, file)).not.toContain(process.pid)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'win32').each([false, true])(
  'reads and types through the owned native console (nested shell: %s)',
  async (nested) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-native-console-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const batch = join(paths.profiles, 'launch_claude-code_fixture.bat')
    writeFileSync(
      batch,
      '@echo off\r\necho NATIVE_CONSOLE_READY\r\nset /p typed=Input:\r\necho INPUT=%typed%\r\npause\r\n'
    )
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Start-Process -FilePath cmd.exe -ArgumentList '${nested ? '/c cmd.exe /c' : '/c'} ""${batch.replaceAll("'", "''")}""' -WindowStyle Normal`
        ],
        { timeout: 10_000 }
      )
      await expect.poll(() => listWindowsCodeTerminals(paths).length, { timeout: 15_000 }).toBe(1)
      const terminal = listWindowsCodeTerminals(paths)[0]
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('NATIVE_CONSOLE_READY')
      windowsTerminalText(paths, terminal, 'verified native input')
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('INPUT=verified native input')
    } finally {
      for (const { pid } of listWindowsCodeTerminals(paths)) {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 })
      }
      rmSync(directory, { recursive: true, force: true })
    }
  },
  60_000
)

it.skipIf(process.platform !== 'win32')(
  'waits for an owned console handle without dropping input failures',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-pending-console-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const batch = join(paths.profiles, 'launch_claude-code_pending.bat')
    writeFileSync(batch, '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n')
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            '$info = [Diagnostics.ProcessStartInfo]::new()',
            "$info.FileName = 'cmd.exe'",
            `$info.Arguments = '/d /c ""${batch.replaceAll("'", "''")}""'`,
            '$info.UseShellExecute = $false',
            '$info.CreateNoWindow = $true',
            '$info.RedirectStandardOutput = $true',
            '$info.RedirectStandardError = $true',
            '$null = [Diagnostics.Process]::Start($info)'
          ].join('; ')
        ],
        { windowsHide: true, timeout: 10_000 }
      )
      await expect.poll(() => listWindowsCodeTerminals(paths).length, { timeout: 15_000 }).toBe(1)
      const terminal = listWindowsCodeTerminals(paths)[0]
      expect(windowsTerminalText(paths, terminal)).toBe('')
      expect(() => windowsTerminalText(paths, terminal, 'must not silently drop this input')).toThrow()
    } finally {
      for (const { pid } of listWindowsCodeTerminals(paths)) {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 })
      }
      rmSync(directory, { recursive: true, force: true })
    }
  },
  60_000
)

const nativePlatform = process.platform === 'darwin' ? 'macos' : 'windows'
const dialogModes =
  process.platform === 'darwin'
    ? (['file', 'multiple', 'directory', 'save', 'save-suggested'] as const)
    : (['file', 'multiple', 'directory', 'save', 'save-suggested', 'print'] as const)

// Verify Electron's returned paths after actual native selection and filename commit.
it.skipIf(!['darwin', 'win32'].includes(process.platform)).each(dialogModes)(
  `completes the real ${nativePlatform} %s dialog`,
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-native-dialog-'))
    const paths = getRunPaths(directory)
    const script = join(paths.private, 'dialog.cjs')
    let child: ChildProcess | undefined
    let logHandle: number | undefined
    try {
      ensureRunDirectories(paths)
      mkdirSync(join(paths.profiles, 'native-dialog'), { recursive: true })
      const inputDirectory = join(paths.fixtures, 'inputs')
      mkdirSync(inputDirectory)
      const inputs = [join(inputDirectory, 'first input.txt'), join(inputDirectory, 'second 输入.txt')]
      for (const input of inputs) writeFileSync(input, 'Owned native input')
      const folder = join(paths.fixtures, 'chosen folder')
      mkdirSync(folder)
      const saved = join(paths.private, 'requested output 输入.txt')
      const isSave = mode === 'save' || mode === 'save-suggested'
      const dialogCall =
        mode === 'print'
          ? 'await new Promise(resolve => window.webContents.print({}, (success, failureReason) => resolve({ success, failureReason })))'
          : isSave
            ? `await dialog.showSaveDialog(${nativePlatform === 'windows' ? 'window, ' : ''}${JSON.stringify({ defaultPath: join(paths.profiles, 'suggested.txt'), ...(mode === 'save' ? { filters: [{ name: 'Text', extensions: ['txt'] }] } : {}) })})`
            : `await dialog.showOpenDialog(${nativePlatform === 'windows' ? 'window, ' : ''}{ properties: ${JSON.stringify(mode === 'directory' ? ['openDirectory'] : mode === 'multiple' ? ['openFile', 'multiSelections'] : ['openFile'])} })`
      const resultPath = join(paths.private, 'result.json')
      const readyPath = join(paths.private, 'ready')
      writeFileSync(
        script,
        `
      const { app, BrowserWindow, dialog } = require('electron')
      const fs = require('node:fs')
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        if (line === 'quit') app.quit()
      })
      app.setPath('userData', ${JSON.stringify(join(paths.profiles, 'native-dialog'))})
      app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(CDP_PORT))})
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 500, height: 300 })
        await window.loadURL('data:text/html,<title>Owned native dialog fixture</title>')
        window.show()
        app.focus({ steal: true })
        fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready')
        const result = ${dialogCall}
        if (result.filePath && !result.canceled) {
          if (fs.realpathSync.native(require('node:path').dirname(result.filePath)) !== fs.realpathSync.native(${JSON.stringify(paths.private)})) throw new Error('Native fixture save escaped its private directory: ' + result.filePath)
          fs.writeFileSync(result.filePath, 'Verified native save', { flag: 'wx' })
        }
        fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result))
      }).catch(error => { fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({error: String(error)})); app.exit(1) })
    `
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      logHandle = openSync(join(paths.logs, 'fixture.log'), 'w')
      child = spawn(createRequire(import.meta.url)('electron') as string, [script], {
        env: environment,
        stdio: ['pipe', logHandle, logHandle],
        windowsHide: false
      })
      await expect.poll(() => existsSync(readyPath), { timeout: 30_000 }).toBe(true)
      writeFileSync(
        paths.appRecord,
        JSON.stringify({
          schemaVersion: 1,
          ownership: 'regression-driver',
          policy: 'ephemeral',
          mode: 'branch',
          platform: nativePlatform,
          targetRoot: directory,
          runnerPid: child.pid,
          electronPid: child.pid,
          cdpPort: CDP_PORT,
          targetUrl: 'data:text/html,fixture',
          logPath: join(paths.logs, 'fixture.log')
        })
      )
      if (mode === 'multiple') chooseNativeFiles(nativePlatform, paths, inputs)
      else if (mode === 'save')
        expect(realpathSync.native(await saveNativeFile(nativePlatform, paths, saved))).toBe(realpathSync.native(saved))
      else if (mode === 'save-suggested') {
        const outcome = await saveNativeFileKeepingName(nativePlatform, paths, saved, true)
        expect(realpathSync.native(outcome.filePath)).toBe(realpathSync.native(join(paths.private, 'suggested.txt')))
      } else if (mode === 'print') {
        await expect.poll(() => readWindowsPrintDialog(paths)).toContain('Cancel')
        await dismissNativeMessageBox(nativePlatform, paths, 'Print', 'Cancel')
      } else chooseNativeFile(nativePlatform, paths, mode === 'directory' ? folder : inputs[0])
      await expect.poll(() => existsSync(resultPath), { timeout: 10_000 }).toBe(true)
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      if (mode === 'print') {
        expect(result.success).toBe(false)
        expect(result.failureReason).toMatch(/cancel/i)
      } else if (isSave) {
        expect(result.canceled).toBe(false)
        const expected = mode === 'save-suggested' ? join(paths.private, 'suggested.txt') : saved
        expect(realpathSync.native(result.filePath)).toBe(realpathSync.native(expected))
        expect(readFileSync(expected, 'utf8')).toBe('Verified native save')
      } else {
        expect(result.canceled).toBe(false)
        expect(result.filePaths.map((file: string) => realpathSync.native(file)).sort()).toEqual(
          (mode === 'multiple' ? inputs : [mode === 'directory' ? folder : inputs[0]])
            .map((file) => realpathSync.native(file))
            .sort()
        )
      }
      if (nativePlatform === 'windows' && mode === 'file') {
        const previous = setWindowsNotificationCenterOpen(paths, true)
        try {
          expect(setWindowsNotificationCenterOpen(paths, true)).toBe(true)
        } finally {
          setWindowsNotificationCenterOpen(paths, previous)
        }
      } else if (nativePlatform === 'macos' && mode === 'file') {
        const previous = setMacNotificationCenterOpen(paths, true)
        try {
          expect(setMacNotificationCenterOpen(paths, true)).toBe(true)
          expect(setMacNotificationCenterOpen(paths, false)).toBe(true)
          expect(setMacNotificationCenterOpen(paths, false)).toBe(false)
        } finally {
          setMacNotificationCenterOpen(paths, previous)
        }
      }
    } catch (error) {
      let controls = 'Fixture exited before native controls could be inspected'
      if (child?.pid && child.exitCode === null && isAlive(child.pid)) {
        try {
          if (nativePlatform === 'macos' && process.env.RUN_DIR) {
            const evidence = getRunPaths(process.env.RUN_DIR).evidence
            mkdirSync(evidence, { recursive: true })
            const bounds = execFileSync(
              'osascript',
              [
                '-e',
                `tell application "System Events"
                  tell (first application process whose unix id is ${child.pid})
                    if not frontmost then error "Owned dialog is not frontmost"
                    return (position of window 1) & (size of window 1)
                  end tell
                end tell`
              ],
              { encoding: 'utf8', timeout: 5000 }
            )
              .trim()
              .split(/,\s*/)
              .map(Number)
            if (
              bounds.length !== 4 ||
              bounds.some((value) => !Number.isFinite(value)) ||
              bounds[2] <= 0 ||
              bounds[3] <= 0
            )
              throw new Error('Owned native dialog bounds are invalid')
            execFileSync(
              '/usr/sbin/screencapture',
              ['-x', '-R' + bounds.join(','), join(evidence, `native-dialog-${mode}.png`)],
              {
                timeout: 5000
              }
            )
          }
          controls =
            nativePlatform === 'macos'
              ? execFileSync(
                  'osascript',
                  [
                    '-e',
                    `
              tell application "System Events"
                tell (first application process whose unix id is ${child.pid})
                  return {unix id, name of every window, name of every button of splitter group 1 of window 1, value of every text field of splitter group 1 of window 1}
                end tell
              end tell
            `
                  ],
                  { encoding: 'utf8', timeout: 10_000 }
                )
              : execFileSync(
                  'powershell.exe',
                  [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `
          Add-Type -AssemblyName UIAutomationClient
          Add-Type -AssemblyName UIAutomationTypes
          $root = [Windows.Automation.AutomationElement]::RootElement
          $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${child.pid})
          $windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $condition)
          foreach ($window in $windows) {
            @($window) + @($window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) |
              ForEach-Object { $c = $_.Current; "{0}|{1}|{2}|{3}|enabled={4}|offscreen={5}|focusable={6}|handle={7}|pid={8}" -f $c.Name, $c.ClassName, $c.AutomationId, $c.ControlType.ProgrammaticName, $c.IsEnabled, $c.IsOffscreen, $c.IsKeyboardFocusable, $c.NativeWindowHandle, $c.ProcessId }
          }
        `
                  ],
                  { encoding: 'utf8', timeout: 10_000 }
                )
        } catch (inspectionError) {
          controls = `Inspection failed: ${String(inspectionError)}`
        }
      }
      const result = join(paths.private, 'result.json')
      const log = join(paths.logs, 'fixture.log')
      const logTail = existsSync(log) ? readFileSync(log, 'utf8').slice(-5000) : ''
      throw new Error(
        `${nativePlatform} ${mode} dialog failed: ${String(error)}. Result: ${existsSync(result) ? readFileSync(result, 'utf8') : 'pending'}. Owned controls:\n${controls}\nFixture log:\n${logTail}`,
        { cause: error }
      )
    } finally {
      const fixture = child
      if (fixture?.pid && fixture.exitCode === null && fixture.signalCode === null) {
        const exited = () => fixture.exitCode !== null || fixture.signalCode !== null
        fixture.stdin?.once('error', () => undefined)
        fixture.stdin?.end('quit\n')
        const stopped = await expect
          .poll(exited, { timeout: 5000 })
          .toBe(true)
          .then(
            () => true,
            () => false
          )
        if (!stopped) {
          expect(processCommand(fixture.pid, nativePlatform), 'Native dialog fixture ownership changed').toContain(
            script
          )
          if (nativePlatform === 'windows')
            execFileSync('taskkill.exe', ['/PID', String(fixture.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 })
          else fixture.kill('SIGTERM')
          await expect.poll(exited, { timeout: 10000 }).toBe(true)
        }
      }
      if (logHandle !== undefined) closeSync(logHandle)
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
  },
  120_000
)
