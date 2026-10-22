import { mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getRawShellEnv } from '@main/utils/shellEnv'
import { CodeCli } from '@shared/types/codeCli'

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: vi.fn(async () => ({})) }))

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
    vi.mocked(getRawShellEnv).mockResolvedValue({})
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

  it('edits existing Copilot config.json until native settings.json is present', async () => {
    const directory = path.join(home, '.copilot')
    await mkdir(directory, { recursive: true })
    const legacy = path.join(directory, 'config.json')
    await writeFile(legacy, '{"theme":"dark"}')
    await writeCliConfigFiles(CodeCli.GITHUB_COPILOT_CLI, [
      { target: 'copilot-settings', content: '{"theme":"light"}' }
    ])
    expect(await readFile(legacy, 'utf8')).toBe('{"theme":"light"}')
    const settings = path.join(directory, 'settings.json')
    await writeFile(settings, '{}')
    const [file] = await readCliConfigFiles(['copilot-settings'])
    expect(file.path).toBe(settings)
  })

  it('edits Kilo JSON in the configured directory without creating a competing JSONC file', async () => {
    const configHome = path.join(home, 'custom-config')
    vi.mocked(getRawShellEnv).mockResolvedValue({ XDG_CONFIG_HOME: configHome })
    const filename = path.join(configHome, 'kilo', 'kilo.json')
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, '{"theme":"dark"}')
    const content = '{"theme":"light"}'
    await writeCliConfigFiles('kilo', [{ target: 'kilo-config', content }])
    expect(await readFile(filename, 'utf8')).toBe(content)
    await expect(stat(`${filename}c`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('honors agent home overrides for raw configuration files', async () => {
    const configHome = path.join(home, 'custom-kiro')
    vi.mocked(getRawShellEnv).mockResolvedValue({ KIRO_HOME: configHome })
    await writeCliConfigFiles('kiro', [{ target: 'kiro-settings', content: '{"telemetry.enabled":false}' }])
    expect(await readFile(path.join(configHome, 'settings', 'cli.json'), 'utf8')).toBe('{"telemetry.enabled":false}')
    await expect(writeCliConfigFiles('kiro', [{ target: 'cursor-config', content: '{}' }])).rejects.toThrow(
      'not a config file'
    )
  })

  it('resolves Trae user configuration for the current platform', async () => {
    const [file] = await readCliConfigFiles(['trae-config'])
    const root =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.platform === 'win32'
          ? path.join(home, 'AppData', 'Roaming')
          : path.join(home, '.config')
    expect(file.path).toBe(path.join(root, 'trae_cli', 'trae_cli.yaml'))
    expect(file.content).toBeNull()
  })

  it('creates and reads CodeBuddy settings in its native user directory', async () => {
    const content = '{"language":"简体中文","permissions":{"deny":["Read(.env)"]}}'
    await writeCliConfigFiles('codebuddy-code', [{ target: 'codebuddy-settings', content }])
    const filename = path.join(home, '.codebuddy', 'settings.json')
    expect(await readFile(filename, 'utf8')).toBe(content)
    expect(await readCliConfigFiles(['codebuddy-settings'])).toEqual([
      { target: 'codebuddy-settings', path: filename, content }
    ])
  })

  it('writes the same CODEX_HOME that a system-terminal launch reads', async () => {
    const customHome = path.join(home, 'custom-codex')
    vi.mocked(getRawShellEnv).mockResolvedValue({ CODEX_HOME: customHome })
    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-config', content: 'model = "selected"' }])
    expect(await readFile(path.join(customHome, 'config.toml'), 'utf8')).toBe('model = "selected"')
    await expect(readFile(codexConfig())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores the native configuration when the model record cannot be committed', async () => {
    await mkdir(path.dirname(claudeSettings()), { recursive: true })
    const original = '{"model":"previous","env":{"ANTHROPIC_AUTH_TOKEN":"keep"}}'
    await writeFile(claudeSettings(), original)
    await expect(
      writeCliConfigFiles(CodeCli.CLAUDE_CODE, [{ target: 'claude-settings', content: '{"model":"next"}' }], () => {
        throw new Error('Database write failed')
      })
    ).rejects.toThrow('Database write failed')
    expect(await readFile(claudeSettings(), 'utf8')).toBe(original)
  })

  it.skipIf(isWin)('preserves a config symlink and rolls back its target after a failed commit', async () => {
    await mkdir(path.dirname(codexConfig()), { recursive: true })
    const target = path.join(home, 'dotfiles.toml')
    await writeFile(target, 'personality = "pragmatic"')
    await symlink(target, codexConfig())
    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-config', content: 'model = "first"' }])
    expect(await readlink(codexConfig())).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('model = "first"')
    await expect(
      writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-config', content: 'model = "second"' }], () => {
        throw new Error('commit failed')
      })
    ).rejects.toThrow('commit failed')
    expect(await readlink(codexConfig())).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('model = "first"')
  })

  it.skipIf(isWin)('writes through a dangling relative config symlink without replacing it', async () => {
    await mkdir(path.dirname(codexConfig()), { recursive: true })
    await symlink('../dotfiles.toml', codexConfig())
    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-config', content: 'model = "first"' }])
    expect(await readlink(codexConfig())).toBe('../dotfiles.toml')
    expect(await readFile(path.join(home, 'dotfiles.toml'), 'utf8')).toBe('model = "first"')
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
    vi.mocked(getRawShellEnv).mockResolvedValue({})
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
