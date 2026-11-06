import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureRunDirectories, getRunPaths } from '../paths'
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
