import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRunDirectories, getRunPaths } from '../paths'
import { CDP_PORT, isAlive, processCommand, waitForExit } from '../process'
import { chooseNativeFile, chooseWindowsNativeFiles, saveNativeFile } from '../systemAutomation'
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

it.skipIf(process.platform !== 'win32')(
  'reads and types through the owned native console',
  async () => {
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
          `Start-Process -FilePath cmd.exe -ArgumentList '/c ""${batch.replaceAll("'", "''")}""' -WindowStyle Normal`
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

// Exercise Electron's actual Common Item Dialog, including the filename edit/commit contract.
it.skipIf(process.platform !== 'win32').each(['file', 'multiple', 'directory', 'save'] as const)(
  'selects the requested path through the real Windows %s dialog',
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-native-dialog-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    mkdirSync(join(paths.profiles, 'native-dialog'), { recursive: true })
    const inputs = [join(paths.fixtures, 'first input.txt'), join(paths.fixtures, 'second 输入.txt')]
    for (const input of inputs) writeFileSync(input, 'Owned native input')
    const folder = join(paths.fixtures, 'chosen folder')
    mkdirSync(folder)
    const saved = join(paths.exports, 'requested output.txt')
    const resultPath = join(paths.private, 'result.json')
    const readyPath = join(paths.private, 'ready')
    const script = join(paths.private, 'dialog.cjs')
    writeFileSync(
      script,
      `
      const { app, BrowserWindow, dialog } = require('electron')
      const fs = require('node:fs')
      app.setPath('userData', ${JSON.stringify(join(paths.profiles, 'native-dialog'))})
      app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(CDP_PORT))})
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 500, height: 300 })
        await window.loadURL('data:text/html,<title>Owned native dialog fixture</title>')
        fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready')
        const result = ${
          mode === 'save'
            ? `await dialog.showSaveDialog(window, { defaultPath: 'suggested.txt', filters: [{name: 'Text', extensions: ['txt']}] })`
            : `await dialog.showOpenDialog(window, { properties: ${JSON.stringify(mode === 'directory' ? ['openDirectory'] : mode === 'multiple' ? ['openFile', 'multiSelections'] : ['openFile'])} })`
        }
        if (result.filePath && !result.canceled) fs.writeFileSync(result.filePath, 'Verified native save')
        fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result))
      }).catch(error => { fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({error: String(error)})); app.exit(1) })
    `
    )
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(createRequire(import.meta.url)('electron') as string, [script], {
      env: environment,
      stdio: 'ignore',
      windowsHide: false
    })
    try {
      await expect.poll(() => existsSync(readyPath), { timeout: 30_000 }).toBe(true)
      writeFileSync(
        paths.appRecord,
        JSON.stringify({
          schemaVersion: 1,
          ownership: 'regression-driver',
          policy: 'ephemeral',
          mode: 'branch',
          platform: 'windows',
          targetRoot: directory,
          runnerPid: child.pid,
          electronPid: child.pid,
          cdpPort: CDP_PORT,
          targetUrl: 'data:text/html,fixture',
          logPath: join(paths.logs, 'fixture.log')
        })
      )
      if (mode === 'multiple') chooseWindowsNativeFiles(paths, inputs)
      else if (mode === 'save') expect(await saveNativeFile('windows', paths, saved)).toBe(saved)
      else chooseNativeFile('windows', paths, mode === 'directory' ? folder : inputs[0])
      await expect.poll(() => existsSync(resultPath), { timeout: 10_000 }).toBe(true)
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      expect(result.canceled).toBe(false)
      if (mode === 'save') {
        expect(result.filePath).toBe(saved)
        expect(readFileSync(saved, 'utf8')).toBe('Verified native save')
      } else {
        expect(result.filePaths.sort()).toEqual(
          (mode === 'multiple' ? inputs : [mode === 'directory' ? folder : inputs[0]]).sort()
        )
      }
    } finally {
      if (child.pid && child.exitCode === null && isAlive(child.pid)) {
        expect(processCommand(child.pid, 'windows'), 'Native dialog fixture ownership changed').toContain(script)
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 })
        expect(await waitForExit(child.pid), 'Owned native dialog fixture did not exit').toBe(true)
      }
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },
  120_000
)
