import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SecretEnvHandoff, type SecretEnvSpec } from '../SecretEnvHandoff'

const execFileAsync = promisify(execFile)
const CLEAR_NAMES = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']
const ENV_FILE_NAME = /^[0-9a-f-]{36}\.env$/
const printEnv = `printf '%s|%s' "\${GEMINI_API_KEY-unset}" "\${GOOGLE_GEMINI_BASE_URL-unset}"`
const runShell = (script: string) => execFileAsync('/bin/sh', ['-c', script], { encoding: 'utf8' })

let launchDir: string

const createHandoff = (values: Record<string, string>, clearNames = CLEAR_NAMES) =>
  SecretEnvHandoff.create(launchDir, { values, clearNames })

beforeEach(async () => {
  launchDir = await mkdtemp(path.join(tmpdir(), 'cherry-secret-env-test-'))
})

afterEach(async () => {
  await rm(launchDir, { recursive: true, force: true })
})

describe('SecretEnvHandoff.create', () => {
  it('gives every launch a separate file and immutable launch identity', async () => {
    const first = await createHandoff({
      GEMINI_API_KEY: 'key-a',
      GOOGLE_GEMINI_BASE_URL: 'https://a.example.test'
    })
    const second = await createHandoff({ GEMINI_API_KEY: 'key-b' })

    expect(first.launchId).not.toBe(second.launchId)
    expect(first.path).not.toBe(second.path)
    expect(path.basename(first.path)).toMatch(ENV_FILE_NAME)
    expect(path.basename(first.path, '.env')).toBe(first.launchId)
    expect(await readFile(first.path, 'utf8')).toBe(
      'GEMINI_API_KEY=key-a\nGOOGLE_GEMINI_BASE_URL=https://a.example.test\n'
    )
    expect(await readFile(second.path, 'utf8')).toBe('GEMINI_API_KEY=key-b\n')
    if (process.platform !== 'win32') expect((await stat(first.path)).mode & 0o777).toBe(0o600)
  })

  it.each<{ label: string; spec: SecretEnvSpec; variable: string }>([
    {
      label: 'record injection',
      spec: { values: { GEMINI_API_KEY: 'first\nSECOND=injected' }, clearNames: CLEAR_NAMES },
      variable: 'GEMINI_API_KEY'
    },
    {
      label: 'empty required value',
      spec: { values: { GEMINI_API_KEY: '' }, clearNames: CLEAR_NAMES },
      variable: 'GEMINI_API_KEY'
    },
    {
      label: 'unsafe clear name',
      spec: { values: { GEMINI_API_KEY: 'key' }, clearNames: ['GEMINI_API_KEY; touch injected'] },
      variable: 'GEMINI_API_KEY; touch injected'
    }
  ])('rejects $label before writing an artifact', async ({ spec, variable }) => {
    await expect(SecretEnvHandoff.create(launchDir, spec)).rejects.toThrow(variable)
    expect(await readdir(launchDir)).toEqual([])
  })
})

describe('SecretEnvHandoff lifecycle', () => {
  it('dispose removes an unowned lease and tolerates one already consumed', async () => {
    const handoff = await createHandoff({ GEMINI_API_KEY: 'unused' })

    await handoff.dispose()

    await expect(stat(handoff.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(handoff.dispose()).resolves.toBeUndefined()
  })

  it('removeExpired collects only expired handoffs and their atomic-write remnants', async () => {
    const stale = await createHandoff({ GEMINI_API_KEY: 'stale' })
    const pending = await createHandoff({ GEMINI_API_KEY: 'pending' })
    const atomicTmp = `${stale.path}.tmp-${randomUUID()}`
    const unrelatedEnv = path.join(launchDir, 'notes.env')
    const unrelatedText = path.join(launchDir, 'notes.txt')
    await writeFile(atomicTmp, 'GEMINI_API_KEY=tmp-secret\n')
    await writeFile(unrelatedEnv, 'keep')
    await writeFile(unrelatedText, 'keep')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000)
    await Promise.all([
      utimes(stale.path, twoHoursAgo, twoHoursAgo),
      utimes(atomicTmp, twoHoursAgo, twoHoursAgo),
      utimes(unrelatedEnv, twoHoursAgo, twoHoursAgo),
      utimes(unrelatedText, twoHoursAgo, twoHoursAgo)
    ])

    await SecretEnvHandoff.removeExpired(launchDir)

    expect((await readdir(launchDir)).sort()).toEqual([path.basename(pending.path), 'notes.env', 'notes.txt'].sort())
    await expect(SecretEnvHandoff.removeExpired(path.join(launchDir, 'missing'))).resolves.toBeUndefined()
  })

  it('removeAll invalidates current and crash-left leases without touching unrelated files', async () => {
    const handoff = await createHandoff({ GEMINI_API_KEY: 'pending' })
    const atomicTmp = `${handoff.path}.tmp-${randomUUID()}`
    await writeFile(atomicTmp, 'GEMINI_API_KEY=tmp-secret\n')
    await writeFile(path.join(launchDir, 'keep.txt'), 'keep')

    await SecretEnvHandoff.removeAll(launchDir)

    expect(await readdir(launchDir)).toEqual(['keep.txt'])
  })
})

describe.skipIf(process.platform === 'win32')('SecretEnvHandoff.wrapPosixCommand', () => {
  it('keeps delayed concurrent launches isolated even when they consume in reverse order', async () => {
    const launchA = await createHandoff({
      GEMINI_API_KEY: 'key-a',
      GOOGLE_GEMINI_BASE_URL: 'https://a.example.test'
    })
    const commandA = launchA.wrapPosixCommand(printEnv)
    const launchB = await createHandoff({
      GEMINI_API_KEY: 'key-b',
      GOOGLE_GEMINI_BASE_URL: 'https://b.example.test'
    })
    const commandB = launchB.wrapPosixCommand(printEnv)

    const resultB = await runShell(commandB)
    const resultA = await runShell(commandA)

    expect(resultA.stdout).toBe('key-a|https://a.example.test')
    expect(resultB.stdout).toBe('key-b|https://b.example.test')
    await expect(stat(launchA.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(launchB.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves exact values in a traced subshell and clears an ambient value the lease omits', async () => {
    const apiKey = 'secret $HOME $(touch nope) \' " = value'
    const handoff = await createHandoff({ GEMINI_API_KEY: apiKey })
    const wrapped = handoff.wrapPosixCommand(printEnv)
    expect(wrapped).not.toContain(apiKey)

    const result = await runShell(
      `GEMINI_API_KEY=ambient-wrong-key GOOGLE_GEMINI_BASE_URL=https://stale.example.test; export GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL; set -x; ${wrapped}; printf '|%s' "$GOOGLE_GEMINI_BASE_URL"`
    )

    expect(result.stdout).toBe(`${apiKey}|unset|https://stale.example.test`)
    expect(result.stderr).not.toContain(apiKey)
  })

  it('deletes a corrupted lease before failing closed on a missing required variable', async () => {
    const marker = path.join(launchDir, 'ran')
    const handoff = await createHandoff({
      GEMINI_API_KEY: 'key',
      GOOGLE_GEMINI_BASE_URL: 'https://example.test'
    })
    await writeFile(handoff.path, 'GEMINI_API_KEY=key\n', { mode: 0o600 })

    await expect(runShell(handoff.wrapPosixCommand(`touch '${marker}'`))).rejects.toMatchObject({
      code: expect.any(Number)
    })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(handoff.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not run the CLI when the lease is missing or cannot be deleted', async () => {
    const missingMarker = path.join(launchDir, 'missing-ran')
    const missing = await createHandoff({ GEMINI_API_KEY: 'key' })
    await missing.dispose()
    await expect(runShell(missing.wrapPosixCommand(`touch '${missingMarker}'`))).rejects.toMatchObject({
      code: expect.any(Number)
    })

    const undeletedMarker = path.join(launchDir, 'undeleted-ran')
    const undeleted = await createHandoff({ GEMINI_API_KEY: 'key' })
    await unlink(undeleted.path)
    await mkdir(undeleted.path)
    await expect(runShell(undeleted.wrapPosixCommand(`touch '${undeletedMarker}'`))).rejects.toMatchObject({
      code: expect.any(Number)
    })

    await expect(stat(missingMarker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(undeletedMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('SecretEnvHandoff.wrapWindowsCommand', () => {
  it('clears, imports, deletes, verifies deletion, then guards and executes', async () => {
    const dir = path.join(launchDir, '100% data')
    await mkdir(dir)
    const handoff = await SecretEnvHandoff.create(dir, {
      values: { GEMINI_API_KEY: 'key' },
      clearNames: CLEAR_NAMES
    })

    const lines = handoff.wrapWindowsCommand('agy --model gemini')
    const clearIndex = lines.indexOf('set "GEMINI_API_KEY="')
    const importIndex = lines.findIndex((line) => line.startsWith('for /f '))
    const deleteIndex = lines.findIndex((line) => line.startsWith('del /f /q '))
    const undeletedIndex = lines.findIndex((line) => line.startsWith('if exist '))
    const guardIndex = lines.findIndex((line) => line.startsWith('if not defined GEMINI_API_KEY'))
    const commandIndex = lines.indexOf('agy --model gemini')

    expect(lines[importIndex]).toContain('100%% data')
    expect(clearIndex).toBeLessThan(importIndex)
    expect(importIndex).toBeLessThan(deleteIndex)
    expect(deleteIndex).toBeLessThan(undeletedIndex)
    expect(undeletedIndex).toBeLessThan(guardIndex)
    expect(guardIndex).toBeLessThan(commandIndex)
    expect(lines).toContain(':_cherry_secret_env_missing')
    expect(lines).toContain(':_cherry_secret_env_undeleted')
  })
})

describe.skipIf(process.platform !== 'win32')('SecretEnvHandoff under cmd.exe', () => {
  const writeLaunchBat = async (
    handoff: SecretEnvHandoff,
    command = 'set GEMINI_API_KEY && set GOOGLE_GEMINI_BASE_URL && exit /b 0'
  ) => {
    const batPath = path.join(launchDir, `launch-${handoff.launchId}.bat`)
    const lines = [
      '@echo off',
      'setlocal EnableExtensions DisableDelayedExpansion',
      ...handoff.wrapWindowsCommand(command)
    ].map((line) => (line === 'pause' ? 'rem pause' : line))
    await writeFile(batPath, `${lines.join('\r\n')}\r\n`, 'utf8')
    return batPath
  }
  const runBat = (batPath: string) =>
    execFileAsync('cmd.exe', ['/v:on', '/c', batPath], {
      encoding: 'utf8',
      env: { ...process.env, GEMINI_API_KEY: 'ambient-wrong-key', GOOGLE_GEMINI_BASE_URL: 'https://stale.test' }
    })

  it('preserves !, %, and & verbatim and consumes the lease', async () => {
    const dir = path.join(launchDir, '100% data')
    await mkdir(dir)
    const handoff = await SecretEnvHandoff.create(dir, {
      values: {
        GEMINI_API_KEY: 'abc!PATH!def',
        GOOGLE_GEMINI_BASE_URL: 'https://x.example.test/%TEMP%?a=1&b=2'
      },
      clearNames: CLEAR_NAMES
    })

    const result = await runBat(await writeLaunchBat(handoff))

    expect(result.stdout.replace(/\r\n/g, '\n').trim().split('\n')).toEqual([
      'GEMINI_API_KEY=abc!PATH!def',
      'GOOGLE_GEMINI_BASE_URL=https://x.example.test/%TEMP%?a=1&b=2'
    ])
    await expect(stat(handoff.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed and deletes an incomplete lease even with ambient variables present', async () => {
    const marker = path.join(launchDir, 'cli-ran')
    const handoff = await createHandoff({
      GEMINI_API_KEY: 'key',
      GOOGLE_GEMINI_BASE_URL: 'https://example.test'
    })
    await writeFile(handoff.path, 'GEMINI_API_KEY=key\n', { mode: 0o600 })

    await expect(
      runBat(await writeLaunchBat(handoff, `echo ran>"${marker.replace(/%/g, '%%')}"`))
    ).rejects.toMatchObject({ code: 1 })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(handoff.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
