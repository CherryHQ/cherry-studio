import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

// Real fs behavior against a real tmpdir, wrapped in vi.fn so individual tests
// can inject write/restore failures at exact call positions.
vi.mock('@main/utils/file/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsUtils>()
  return {
    ...actual,
    atomicWriteFile: vi.fn(actual.atomicWriteFile),
    remove: vi.fn(actual.remove)
  }
})

import { application } from '@application'
import type * as fsUtils from '@main/utils/file/fs'
import { atomicWriteFile, remove } from '@main/utils/file/fs'

import { writeCliConfigFiles } from '../configWriter'

const isWin = process.platform === 'win32'

/** Pass-through to the real atomicWriteFile, for mockImplementationOnce chains. */
async function actualWrite(...args: Parameters<typeof atomicWriteFile>) {
  const { atomicWriteFile: actual } = await vi.importActual<typeof fsUtils>('@main/utils/file/fs')
  return actual(...args)
}

describe('writeCliConfigFiles', () => {
  let home: string
  const claudeSettings = () => path.join(home, '.claude', 'settings.json')
  const codexConfig = () => path.join(home, '.codex', 'config.toml')
  const codexAuth = () => path.join(home, '.codex', 'auth.json')

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'cherry-cli-config-'))
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'sys.home') return home
      throw new Error(`Unexpected getPath(${key})`)
    })
  })

  afterEach(async () => {
    vi.mocked(atomicWriteFile).mockClear()
    vi.mocked(remove).mockClear()
    await rm(home, { recursive: true, force: true })
  })

  it('writes each file 0600 under the resolved home path, creating parent dirs', async () => {
    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [
      { target: 'codex-config', content: 'model = "gpt-5"\n' },
      { target: 'codex-auth', content: '{"OPENAI_API_KEY":"sk-secret"}\n' }
    ])

    expect(await readFile(codexConfig(), 'utf-8')).toBe('model = "gpt-5"\n')
    expect(await readFile(codexAuth(), 'utf-8')).toBe('{"OPENAI_API_KEY":"sk-secret"}\n')
    if (!isWin) {
      expect((await stat(codexConfig())).mode & 0o777).toBe(0o600)
      expect((await stat(codexAuth())).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects a target that is not a config file of the tool, writing nothing', async () => {
    await expect(writeCliConfigFiles(CodeCli.CLAUDE_CODE, [{ target: 'codex-auth', content: '{}' }])).rejects.toThrow(
      'codex-auth is not a config file of claude-code'
    )
    expect(atomicWriteFile).not.toHaveBeenCalled()
  })

  it('rejects a duplicate target in one batch, writing nothing', async () => {
    await expect(
      writeCliConfigFiles(CodeCli.CLAUDE_CODE, [
        { target: 'claude-settings', content: '{}' },
        { target: 'claude-settings', content: '{"a":1}' }
      ])
    ).rejects.toThrow('Duplicate config target: claude-settings')
    expect(atomicWriteFile).not.toHaveBeenCalled()
  })

  it('restores the previous content of an already-written file when a later write fails', async () => {
    await mkdir(path.dirname(codexConfig()), { recursive: true })
    await writeFile(codexConfig(), 'user_key = "keep"\n')
    vi.mocked(atomicWriteFile)
      .mockImplementationOnce(actualWrite) // codex-config write
      .mockRejectedValueOnce(new Error('disk full')) // codex-auth write fails

    await expect(
      writeCliConfigFiles(CodeCli.OPENAI_CODEX, [
        { target: 'codex-config', content: 'model = "new"\n' },
        { target: 'codex-auth', content: '{}' }
      ])
    ).rejects.toThrow('disk full')

    expect(await readFile(codexConfig(), 'utf-8')).toBe('user_key = "keep"\n')
  })

  it('hard-deletes a file that did not exist before when a later write fails', async () => {
    vi.mocked(atomicWriteFile)
      .mockImplementationOnce(actualWrite) // codex-config write
      .mockRejectedValueOnce(new Error('disk full')) // codex-auth write fails

    await expect(
      writeCliConfigFiles(CodeCli.OPENAI_CODEX, [
        { target: 'codex-config', content: 'model = "new"\n' },
        { target: 'codex-auth', content: '{}' }
      ])
    ).rejects.toThrow('disk full')

    await expect(stat(codexConfig())).rejects.toThrow()
  })

  it('aborts before any write when a snapshot read fails for a non-ENOENT reason', async () => {
    // A directory at the target path makes the snapshot read fail with EISDIR —
    // a real "cannot tell what is there" error that must never be treated as
    // "file missing" (which would delete it during a later rollback).
    await mkdir(claudeSettings(), { recursive: true })

    await expect(
      writeCliConfigFiles(CodeCli.CLAUDE_CODE, [{ target: 'claude-settings', content: '{}' }])
    ).rejects.toThrow()
    expect(atomicWriteFile).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect((await stat(claudeSettings())).isDirectory()).toBe(true)
  })

  it('surfaces the original error and still rolls back the rest when a restore itself fails', async () => {
    await mkdir(path.dirname(codexConfig()), { recursive: true })
    await writeFile(codexConfig(), 'config_old = true\n')
    await writeFile(codexAuth(), '{"user":"keep"}\n')
    // Writes: codex-config (ok), codex-auth (fails) → rollback in reverse:
    // codex-auth's restore fails, then codex-config's restore must still run.
    vi.mocked(atomicWriteFile)
      .mockImplementationOnce(actualWrite) // codex-config write
      .mockRejectedValueOnce(new Error('disk full')) // codex-auth write fails
      .mockRejectedValueOnce(new Error('restore failed: disk still full')) // codex-auth restore fails
      .mockImplementationOnce(actualWrite) // codex-config restore must still run

    await expect(
      writeCliConfigFiles(CodeCli.OPENAI_CODEX, [
        { target: 'codex-config', content: 'config_new = true\n' },
        { target: 'codex-auth', content: '{"new":true}\n' }
      ])
    ).rejects.toThrow('disk full')

    expect(await readFile(codexConfig(), 'utf-8')).toBe('config_old = true\n')
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('roll back'), expect.any(Error))
  })
})
