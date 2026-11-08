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

import { ensureRunDirectories, getRunPaths, type RunPaths } from '../paths'
import { CDP_PORT, isAlive, processCommand, waitForExit } from '../process'
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
import { listWindowsCodeTerminals, type WindowsTerminal, windowsTerminalText } from '../windowsTerminal'

function saveConsoleFixtureIdentity(identityPath: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '$current = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"',
    '$identity = ConvertTo-Json -InputObject @{ pid = $child.Id; startedAt = $current.CreationDate.ToUniversalTime().Ticks.ToString() } -Compress',
    `[IO.File]::WriteAllText('${identityPath.replaceAll("'", "''")}', $identity)`
  ].join('; ')
}

async function cleanupConsoleFixture(
  paths: RunPaths,
  identityPath: string,
  errors: unknown[],
  startedPid?: number
): Promise<void> {
  const testFailed = errors.length > 0
  try {
    const candidatesPath = join(paths.logs, 'windows-terminal-candidates.json')
    if (testFailed && existsSync(candidatesPath)) {
      const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8')) as (WindowsTerminal & {
        consoleWindow?: string
      })[]
      errors.push(
        new Error(
          `Console candidates: ${JSON.stringify(candidates.map(({ pid, startedAt, consoleWindow }) => ({ pid, startedAt, consoleWindow })))}`
        )
      )
    }
    if ((startedPid || testFailed) && !existsSync(identityPath)) {
      throw new Error(`Console fixture PID ${startedPid ?? 'unknown'} has no verified identity; retained ${paths.root}`)
    }
    if (existsSync(identityPath)) {
      const terminal = JSON.parse(readFileSync(identityPath, 'utf8')) as WindowsTerminal
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            '$ErrorActionPreference = "Stop"',
            `$current = Get-CimInstance Win32_Process -Filter "ProcessId = ${terminal.pid}"`,
            'if (-not $current) { exit 0 }',
            `if ($current.CreationDate.ToUniversalTime().Ticks.ToString() -ne '${terminal.startedAt}' -or -not $current.CommandLine -or $current.CommandLine.IndexOf('${paths.root.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Refusing to stop an unowned console fixture' }`,
            `& taskkill.exe /PID ${terminal.pid} /T /F`,
            'if ($LASTEXITCODE -ne 0) { throw "Console fixture cleanup failed" }'
          ].join('; ')
        ],
        { stdio: 'ignore', timeout: 10_000 }
      )
      expect(await waitForExit(terminal.pid)).toBe(true)
    }
    rmSync(paths.root, { recursive: true, force: true })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new AggregateError(errors, errors.map(String).join('\n'))
}

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

it.skipIf(process.platform !== 'win32').each(['direct', 'shared', 'detached'] as const)(
  'reads and types through the owned native console (%s shell)',
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-native-console-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const batch = join(paths.profiles, 'launch_claude-code_fixture.bat')
    const cursorReady = join(paths.private, 'console-cursor-ready')
    writeFileSync(
      batch,
      '@echo off\r\necho NATIVE_CONSOLE_READY\r\n' +
        `powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $row=[Console]::CursorTop; [Console]::WriteLine(); [Console]::WriteLine('NATIVE_FOOTER_BELOW_CURSOR'); [Console]::SetCursorPosition(0,$row); [IO.File]::WriteAllText('${cursorReady.replaceAll("'", "''")}', 'ready')"\r\n` +
        'set /p typed=Input:\r\necho INPUT=%typed%\r\npause\r\n'
    )
    const identityPath = join(paths.private, 'console-identity.json')
    const errors: unknown[] = []
    let startedPid: number | undefined
    try {
      if (mode === 'detached') {
        const child = spawn('cmd', ['/c', batch], { detached: true, shell: true, stdio: 'ignore' })
        startedPid = child.pid
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        writeFileSync(
          join(paths.private, 'console-pending-owner.json'),
          JSON.stringify({ pid: startedPid, identityVerified: false })
        )
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$child = Get-Process -Id ${child.pid}; ${saveConsoleFixtureIdentity(identityPath)}`
          ],
          { stdio: 'ignore', timeout: 10_000 }
        )
      } else
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$child = Start-Process -FilePath cmd.exe -ArgumentList '${mode === 'shared' ? '/c cmd.exe /c' : '/c'} ""${batch.replaceAll("'", "''")}""' -WindowStyle Normal -PassThru; ${saveConsoleFixtureIdentity(identityPath)}`
          ],
          { stdio: 'ignore', timeout: 10_000 }
        )
      await expect.poll(() => listWindowsCodeTerminals(paths).length, { timeout: 15_000 }).toBe(1)
      const terminal = listWindowsCodeTerminals(paths)[0]
      await expect.poll(() => existsSync(cursorReady), { timeout: 15_000 }).toBe(true)
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('NATIVE_CONSOLE_READY')
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('NATIVE_FOOTER_BELOW_CURSOR')
      expect(() => windowsTerminalText(paths, { ...terminal, startedAt: '0' }, 'unowned input')).toThrow()
      windowsTerminalText(paths, terminal, 'verified native input', null)
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('verified native input')
      expect(windowsTerminalText(paths, terminal)).not.toContain('INPUT=verified native input')
      windowsTerminalText(paths, terminal, '')
      await expect
        .poll(() => windowsTerminalText(paths, terminal), { timeout: 15_000 })
        .toContain('INPUT=verified native input')
    } catch (error) {
      errors.push(error)
    } finally {
      await cleanupConsoleFixture(paths, identityPath, errors, startedPid)
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
    writeFileSync(batch, '@echo off\r\nping -n 60 127.0.0.1 >nul\r\n')
    const identityPath = join(paths.private, 'console-identity.json')
    const errors: unknown[] = []
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
            '$child = [Diagnostics.Process]::Start($info)',
            saveConsoleFixtureIdentity(identityPath)
          ].join('; ')
        ],
        { windowsHide: true, stdio: 'ignore', timeout: 10_000 }
      )
      const terminal = JSON.parse(readFileSync(identityPath, 'utf8')) as WindowsTerminal
      expect(listWindowsCodeTerminals(paths)).toEqual([])
      expect(JSON.parse(readFileSync(join(paths.logs, 'windows-terminal-candidates.json'), 'utf8'))).toContainEqual({
        ...terminal,
        consoleWindow: '0'
      })
      expect(windowsTerminalText(paths, terminal)).toBe('')
      expect(() => windowsTerminalText(paths, terminal, 'must not silently drop this input')).toThrow()
    } catch (error) {
      errors.push(error)
    } finally {
      await cleanupConsoleFixture(paths, identityPath, errors)
    }
  },
  60_000
)

const nativePlatform = process.platform === 'darwin' ? 'macos' : 'windows'
const dialogModes =
  process.platform === 'darwin'
    ? (['file', 'multiple', 'directory', 'save', 'save-suggested'] as const)
    : (['file', 'multiple', 'directory', 'save', 'save-suggested', 'print', 'message-box'] as const)

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
        mode === 'message-box'
          ? `{ response: dialog.showMessageBoxSync({ type: 'info', title: 'Manual Restart Required', message: 'Owned restart fixture', buttons: ['OK'] }) }`
          : mode === 'print'
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
      } else if (mode === 'message-box') {
        await dismissNativeMessageBox(nativePlatform, paths, 'Manual Restart Required')
      } else chooseNativeFile(nativePlatform, paths, mode === 'directory' ? folder : inputs[0])
      await expect.poll(() => existsSync(resultPath), { timeout: 10_000 }).toBe(true)
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      if (mode === 'message-box') {
        expect(result.response).toBe(0)
        const diagnostic = JSON.parse(readFileSync(join(paths.logs, 'native-message-box.json'), 'utf8'))
        expect(diagnostic.events).toContainEqual(
          expect.objectContaining({
            stage: 'matched',
            button: expect.objectContaining({ controlType: 'ControlType.Button', name: 'OK', buttonMatches: true })
          })
        )
      } else if (mode === 'print') {
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
