import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { AbsoluteFilePathSchema } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { batchLinesReadingSecretEnv, wrapPosixCommandWithSecretEnv, writeSecretEnvFile } from '../secretEnvFile'

const execFileAsync = promisify(execFile)

let tempRoot: string
const envPath = () => AbsoluteFilePathSchema.parse(path.join(tempRoot, '.env'))

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'cherry-secret-env-test-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('writeSecretEnvFile', () => {
  it('writes one owner-only dotenv record per variable and replaces the previous launch file', async () => {
    await writeSecretEnvFile(envPath(), {
      GEMINI_API_KEY: 'stale-key',
      GOOGLE_GEMINI_BASE_URL: 'https://old.example.test'
    })

    const file = await writeSecretEnvFile(envPath(), { GEMINI_API_KEY: 'fresh-key' })

    expect(file).toEqual({ path: envPath(), names: ['GEMINI_API_KEY'] })
    expect(await readFile(envPath(), 'utf8')).toBe('GEMINI_API_KEY=fresh-key\n')
    if (process.platform !== 'win32') expect((await stat(envPath())).mode & 0o777).toBe(0o600)
  })

  it('rejects a value that would smuggle a second record and leaves no file behind', async () => {
    await expect(writeSecretEnvFile(envPath(), { GEMINI_API_KEY: 'first\nSECOND=injected' })).rejects.toThrow(
      'GEMINI_API_KEY'
    )
    await expect(stat(envPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(process.platform === 'win32')('wrapPosixCommandWithSecretEnv', () => {
  it('exports the exact values only inside the wrapped command, overriding ambient values', async () => {
    const apiKey = 'secret $HOME $(touch nope) \' " = value'
    const baseUrl = 'https://gemini.example.test/v1?token=$TOKEN&mode=direct'
    const file = await writeSecretEnvFile(envPath(), { GEMINI_API_KEY: apiKey, GOOGLE_GEMINI_BASE_URL: baseUrl })

    const wrapped = wrapPosixCommandWithSecretEnv(
      file,
      `printf '%s\\n%s\\n' "$GEMINI_API_KEY" "$GOOGLE_GEMINI_BASE_URL"`
    )
    expect(wrapped).not.toContain(apiKey)
    expect(wrapped).not.toContain(baseUrl)

    const result = await execFileAsync(
      '/bin/sh',
      [
        '-c',
        `GEMINI_API_KEY=ambient-wrong-key; export GEMINI_API_KEY; set -x; ${wrapped}; printf '%s' "$GEMINI_API_KEY"`
      ],
      { encoding: 'utf8' }
    )
    // Inside the subshell the file wins over the ambient value; afterwards the calling shell still
    // holds its own value and never saw the secret.
    expect(result.stdout).toBe(`${apiKey}\n${baseUrl}\nambient-wrong-key`)
    expect(result.stderr).not.toContain(apiKey)
    expect(result.stderr).not.toContain(baseUrl)
  })

  it.each([
    ['the file is missing', () => ({ path: path.join(tempRoot, 'missing.env'), names: ['GEMINI_API_KEY'] })],
    [
      'a declared variable is absent from the file',
      async () => ({
        ...(await writeSecretEnvFile(envPath(), { GEMINI_API_KEY: 'only-one' })),
        names: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']
      })
    ]
  ])('refuses to run the command when %s', async (_label, makeFile) => {
    const marker = path.join(tempRoot, 'ran')
    const wrapped = wrapPosixCommandWithSecretEnv(await makeFile(), `touch '${marker}'`)

    await expect(execFileAsync('/bin/sh', ['-c', wrapped])).rejects.toMatchObject({ code: expect.any(Number) })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('batchLinesReadingSecretEnv', () => {
  it('clears ambient values before importing the %-doubled file, then guards every variable', () => {
    const lines = batchLinesReadingSecretEnv(
      { path: 'C:\\Users\\me\\100% data\\Antigravity\\.env', names: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'] },
      'secret_env_missing'
    )

    const importIndex = lines.findIndex((line) => line.startsWith('for /f'))
    expect(lines[importIndex]).toBe(
      'for /f "usebackq tokens=1,* delims==" %%a in ("C:\\Users\\me\\100%% data\\Antigravity\\.env") do set "%%a=%%b"'
    )
    expect(lines.slice(0, importIndex)).toEqual(['set "GEMINI_API_KEY="', 'set "GOOGLE_GEMINI_BASE_URL="'])
    expect(lines.slice(importIndex + 1)).toEqual([
      'if not defined GEMINI_API_KEY goto :secret_env_missing',
      'if not defined GOOGLE_GEMINI_BASE_URL goto :secret_env_missing'
    ])
  })
})
