import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  batchLinesReadingSecretEnv,
  createSecretEnvFile,
  removeSecretEnvFile,
  removeStaleSecretEnvFiles,
  wrapPosixCommandWithSecretEnv
} from '../secretEnvFile'

const execFileAsync = promisify(execFile)
const CLEAR_NAMES = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']
const ENV_FILE_NAME = /^[0-9a-f-]{36}\.env$/
const printEnv = `printf '%s|%s' "\${GEMINI_API_KEY-unset}" "\${GOOGLE_GEMINI_BASE_URL-unset}"`
const runShell = (script: string) => execFileAsync('/bin/sh', ['-c', script], { encoding: 'utf8' })

let launchDir: string

beforeEach(async () => {
  launchDir = await mkdtemp(path.join(tmpdir(), 'cherry-secret-env-test-'))
})

afterEach(async () => {
  await rm(launchDir, { recursive: true, force: true })
})

describe('createSecretEnvFile', () => {
  it('writes each launch to its own owner-only file without touching an earlier launch', async () => {
    const first = await createSecretEnvFile(
      launchDir,
      { GEMINI_API_KEY: 'key-a', GOOGLE_GEMINI_BASE_URL: 'https://a.example.test' },
      CLEAR_NAMES
    )
    const second = await createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'key-b' }, CLEAR_NAMES)

    expect(first.path).not.toBe(second.path)
    expect(path.basename(first.path)).toMatch(ENV_FILE_NAME)
    expect(await readFile(first.path, 'utf8')).toBe(
      'GEMINI_API_KEY=key-a\nGOOGLE_GEMINI_BASE_URL=https://a.example.test\n'
    )
    expect(await readFile(second.path, 'utf8')).toBe('GEMINI_API_KEY=key-b\n')
    // The base URL is cleared even though this launch does not define it.
    expect(second).toEqual({ path: second.path, requiredNames: ['GEMINI_API_KEY'], clearNames: CLEAR_NAMES })
    if (process.platform !== 'win32') expect((await stat(first.path)).mode & 0o777).toBe(0o600)
  })

  it('rejects a value that would smuggle a second record and leaves no file behind', async () => {
    await expect(
      createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'first\nSECOND=injected' }, CLEAR_NAMES)
    ).rejects.toThrow('GEMINI_API_KEY')
    expect(await readdir(launchDir)).toEqual([])
  })
})

describe('unused and stale files', () => {
  it('removeSecretEnvFile deletes the file and tolerates one that is already gone', async () => {
    const file = await createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'unused' }, CLEAR_NAMES)

    await removeSecretEnvFile(file)

    await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(removeSecretEnvFile(file)).resolves.toBeUndefined()
  })

  it('removeStaleSecretEnvFiles drops only .env files older than the threshold', async () => {
    const stale = await createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'stale' }, CLEAR_NAMES)
    const pending = await createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'pending' }, CLEAR_NAMES)
    const unrelated = path.join(launchDir, 'notes.txt')
    await writeFile(unrelated, 'keep')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000)
    await utimes(stale.path, twoHoursAgo, twoHoursAgo)
    await utimes(unrelated, twoHoursAgo, twoHoursAgo)

    await removeStaleSecretEnvFiles(launchDir, 60 * 60_000)

    expect((await readdir(launchDir)).sort()).toEqual([path.basename(pending.path), 'notes.txt'].sort())
    await expect(removeStaleSecretEnvFiles(path.join(launchDir, 'missing'))).resolves.toBeUndefined()
  })
})

describe.skipIf(process.platform === 'win32')('wrapPosixCommandWithSecretEnv', () => {
  it('gives a delayed launch its own credentials even after a later launch was prepared', async () => {
    const launchA = await createSecretEnvFile(
      launchDir,
      { GEMINI_API_KEY: 'key-a', GOOGLE_GEMINI_BASE_URL: 'https://a.example.test' },
      CLEAR_NAMES
    )
    const commandA = wrapPosixCommandWithSecretEnv(launchA, printEnv)
    const launchB = await createSecretEnvFile(
      launchDir,
      { GEMINI_API_KEY: 'key-b', GOOGLE_GEMINI_BASE_URL: 'https://b.example.test' },
      CLEAR_NAMES
    )
    const commandB = wrapPosixCommandWithSecretEnv(launchB, printEnv)

    // B's terminal imports first; A's (e.g. still on Tabby's confirmation dialog) imports later.
    const resultB = await runShell(commandB)
    const resultA = await runShell(commandA)

    expect(resultA.stdout).toBe('key-a|https://a.example.test')
    expect(resultB.stdout).toBe('key-b|https://b.example.test')
    await expect(stat(launchA.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(launchB.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exports exact values only inside the subshell and clears ambient values the file omits', async () => {
    const apiKey = 'secret $HOME $(touch nope) \' " = value'
    const file = await createSecretEnvFile(launchDir, { GEMINI_API_KEY: apiKey }, CLEAR_NAMES)
    const wrapped = wrapPosixCommandWithSecretEnv(file, printEnv)
    expect(wrapped).not.toContain(apiKey)

    const result = await runShell(
      `GEMINI_API_KEY=ambient-wrong-key GOOGLE_GEMINI_BASE_URL=https://stale.example.test; export GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL; set -x; ${wrapped}; printf '|%s' "$GOOGLE_GEMINI_BASE_URL"`
    )

    // Inside: the file's key wins and the undefined base URL is cleared, not inherited.
    // Afterwards: the calling shell still holds its own values and never saw the secret.
    expect(result.stdout).toBe(`${apiKey}|unset|https://stale.example.test`)
    expect(result.stderr).not.toContain(apiKey)
  })

  it.each([
    [
      'the file is missing',
      () => ({ path: path.join(launchDir, 'missing.env'), requiredNames: ['GEMINI_API_KEY'], clearNames: CLEAR_NAMES })
    ],
    [
      'a required variable is absent from the file',
      async () => ({
        ...(await createSecretEnvFile(launchDir, { GEMINI_API_KEY: 'only-one' }, CLEAR_NAMES)),
        requiredNames: CLEAR_NAMES
      })
    ]
  ])('refuses to run the command when %s', async (_label, makeFile) => {
    const marker = path.join(launchDir, 'ran')
    const wrapped = wrapPosixCommandWithSecretEnv(await makeFile(), `touch '${marker}'`)

    await expect(runShell(wrapped)).rejects.toMatchObject({ code: expect.any(Number) })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('batchLinesReadingSecretEnv', () => {
  it('clears every known variable, imports the %-doubled file, guards the required ones, then deletes it', () => {
    const lines = batchLinesReadingSecretEnv(
      {
        path: 'C:\\Users\\me\\100% data\\Antigravity\\launch\\a.env',
        requiredNames: ['GEMINI_API_KEY'],
        clearNames: CLEAR_NAMES
      },
      'secret_env_missing'
    )

    expect(lines).toEqual([
      'set "GEMINI_API_KEY="',
      'set "GOOGLE_GEMINI_BASE_URL="',
      'for /f "usebackq tokens=1,* delims==" %%a in ("C:\\Users\\me\\100%% data\\Antigravity\\launch\\a.env") do set "%%a=%%b"',
      'if not defined GEMINI_API_KEY goto :secret_env_missing',
      'del /f /q "C:\\Users\\me\\100%% data\\Antigravity\\launch\\a.env"'
    ])
  })
})
