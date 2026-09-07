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

const hermesHomeMock = vi.hoisted(() => ({ getHermesHome: vi.fn() }))

vi.mock('../hermesHome', () => hermesHomeMock)

// Real fs behavior against a real tmpdir, wrapped in vi.fn so individual tests
// can inject write/restore failures at exact call positions.
vi.mock('@main/utils/file/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsUtils>()
  return {
    ...actual,
    atomicWriteFile: vi.fn(actual.atomicWriteFile),
    read: vi.fn(actual.read),
    remove: vi.fn(actual.remove)
  }
})

import { application } from '@application'
import type * as fsUtils from '@main/utils/file/fs'
import { atomicWriteFile, read, remove } from '@main/utils/file/fs'

import { readCliConfigFiles, writeCliConfigFiles } from '../configWriter'

const isWin = process.platform === 'win32'

/** Pass-through to the real atomicWriteFile, for mockImplementationOnce chains. */
async function actualWrite(...args: Parameters<typeof atomicWriteFile>) {
  const { atomicWriteFile: actual } = await vi.importActual<typeof fsUtils>('@main/utils/file/fs')
  return actual(...args)
}

async function actualRead(...args: Parameters<typeof read>) {
  const { read: implementation } = await vi.importActual<typeof fsUtils>('@main/utils/file/fs')
  return implementation(...args)
}

describe('writeCliConfigFiles', () => {
  let home: string
  const claudeSettings = () => path.join(home, '.claude', 'settings.json')
  const codexConfig = () => path.join(home, '.codex', 'config.toml')
  const codexAuth = () => path.join(home, '.codex', 'auth.json')
  const hermesHome = () => path.join(home, 'custom-hermes')

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'cherry-cli-config-'))
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'sys.home') return home
      throw new Error(`Unexpected getPath(${key})`)
    })
    hermesHomeMock.getHermesHome.mockImplementation(async () => hermesHome())
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

  it('writes Hermes files under the pinned Hermes home', async () => {
    await writeCliConfigFiles(CodeCli.HERMES, [
      { target: 'hermes-config', content: 'model: {}\n' },
      { target: 'hermes-env', content: 'OPENAI_API_KEY=secret\n' }
    ])

    expect(await readFile(path.join(hermesHome(), 'config.yaml'), 'utf-8')).toBe('model: {}\n')
    expect(await readFile(path.join(hermesHome(), '.env'), 'utf-8')).toBe('OPENAI_API_KEY=secret\n')
  })

  it('deletes a requested config file', async () => {
    await mkdir(path.dirname(codexAuth()), { recursive: true })
    await writeFile(codexAuth(), '{"auth_mode":"apikey"}\n')

    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-auth', delete: true }])

    await expect(stat(codexAuth())).rejects.toThrow()
  })

  it('restores a deleted file when a later mutation fails', async () => {
    await mkdir(path.dirname(codexAuth()), { recursive: true })
    await writeFile(codexAuth(), '{"auth_mode":"apikey"}\n')
    vi.mocked(atomicWriteFile).mockRejectedValueOnce(new Error('disk full')).mockImplementationOnce(actualWrite)

    await expect(
      writeCliConfigFiles(CodeCli.OPENAI_CODEX, [
        { target: 'codex-auth', delete: true },
        { target: 'codex-config', content: 'model = "new"\n' }
      ])
    ).rejects.toThrow('disk full')

    expect(await readFile(codexAuth(), 'utf-8')).toBe('{"auth_mode":"apikey"}\n')
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

describe('readCliConfigFiles', () => {
  let home: string
  const claudeSettings = () => path.join(home, '.claude', 'settings.json')
  const codexConfig = () => path.join(home, '.codex', 'config.toml')
  const codexAuth = () => path.join(home, '.codex', 'auth.json')
  const hermesHome = () => path.join(home, 'custom-hermes')

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'cherry-cli-config-'))
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'sys.home') return home
      throw new Error(`Unexpected getPath(${key})`)
    })
    hermesHomeMock.getHermesHome.mockImplementation(async () => hermesHome())
  })

  afterEach(async () => {
    vi.mocked(read).mockReset()
    vi.mocked(read).mockImplementation(actualRead)
    await rm(home, { recursive: true, force: true })
  })

  it('reads targets concurrently while preserving their input mapping', async () => {
    let resolveConfig!: (value: string) => void
    let resolveAuth!: (value: string) => void
    const config = new Promise<string>((resolve) => {
      resolveConfig = resolve
    })
    const auth = new Promise<string>((resolve) => {
      resolveAuth = resolve
    })
    vi.mocked(read).mockImplementation(((absPath: Parameters<typeof read>[0]) => {
      if (absPath === codexConfig()) return config
      if (absPath === codexAuth()) return auth
      throw new Error(`Unexpected read(${absPath})`)
    }) as typeof read)
    vi.mocked(read).mockClear()

    const reading = readCliConfigFiles(['codex-config', 'codex-auth'])

    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    resolveAuth('{"auth_mode":"apikey"}\n')
    resolveConfig('model = "gpt-5"\n')

    await expect(reading).resolves.toEqual([
      { target: 'codex-config', path: codexConfig(), content: 'model = "gpt-5"\n' },
      { target: 'codex-auth', path: codexAuth(), content: '{"auth_mode":"apikey"}\n' }
    ])
  })

  it('returns the real content under the spec-resolved absolute path', async () => {
    await mkdir(path.dirname(claudeSettings()), { recursive: true })
    await writeFile(claudeSettings(), '{"env":{}}\n')

    await expect(readCliConfigFiles(['claude-settings'])).resolves.toEqual([
      { target: 'claude-settings', path: claudeSettings(), content: '{"env":{}}\n' }
    ])
  })

  it('reads Hermes files from the pinned Hermes home', async () => {
    const configPath = path.join(hermesHome(), 'config.yaml')
    await mkdir(hermesHome(), { recursive: true })
    await writeFile(configPath, 'model: {}\n')

    await expect(readCliConfigFiles(['hermes-config'])).resolves.toEqual([
      { target: 'hermes-config', path: configPath, content: 'model: {}\n' }
    ])
  })

  it('maps a missing file to content null while still resolving its path', async () => {
    await expect(readCliConfigFiles(['claude-settings'])).resolves.toEqual([
      { target: 'claude-settings', path: claudeSettings(), content: null }
    ])
  })

  it('rejects on a non-ENOENT read error (EISDIR) instead of treating it as missing', async () => {
    await mkdir(claudeSettings(), { recursive: true })

    await expect(readCliConfigFiles(['claude-settings'])).rejects.toThrow()
  })
})
