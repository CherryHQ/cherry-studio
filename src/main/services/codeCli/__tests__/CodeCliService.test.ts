import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', () => ({
  application: {
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'BinaryManager') {
        return {
          installTool: vi.fn(() => Promise.resolve({ version: 'latest' })),
          removeTool: vi.fn(() => Promise.resolve())
        }
      }
      return {}
    }),
    getPath: vi.fn().mockReturnValue('/mock/binary-data')
  }
}))

const providerServiceMock = vi.hoisted(() => ({
  getByProviderId: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: providerServiceMock
}))

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
const platformMock = vi.hoisted(() => ({
  isMac: true,
  isWin: false
}))
const shellEnvMock = vi.hoisted(() => ({
  getShellEnv: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platformMock.isMac
  },
  get isWin() {
    return platformMock.isWin
  }
}))

vi.mock('@main/utils/processRunner', () => ({
  removeEnvProxy: vi.fn()
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: shellEnvMock.getShellEnv
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn().mockResolvedValue(false) }
}))

vi.mock('@main/utils/binaryResolver', () => ({
  getBinaryName: vi.fn().mockReturnValue('bun'),
  getBinaryPath: vi.fn().mockResolvedValue('/mock/bin/tool'),
  isBinaryExists: vi.fn().mockResolvedValue(false)
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ stdout: '' }))
}))

vi.mock('semver', () => ({
  default: { coerce: vi.fn(), gte: vi.fn().mockReturnValue(false) }
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn()
}))

async function loadModules() {
  const { BaseService } = await import('@main/core/lifecycle')
  const { CodeCliService } = await import('../CodeCliService')
  const codeCliService = new CodeCliService()
  return { BaseService, CodeCliService, codeCliService }
}

describe('CodeCliService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    platformMock.isMac = true
    platformMock.isWin = false
    shellEnvMock.getShellEnv.mockResolvedValue({})
  })

  it('should extend BaseService', async () => {
    const { BaseService, codeCliService } = await loadModules()
    expect(codeCliService).toBeInstanceOf(BaseService)
  })

  it('should have onInit that preloads terminals', async () => {
    const { codeCliService } = await loadModules()
    await expect(codeCliService._doInit()).resolves.toBeUndefined()
    expect(codeCliService.isReady).toBe(true)
  })

  it('should clean up timers on stop', async () => {
    const { codeCliService } = await loadModules()
    await codeCliService._doInit()
    await expect(codeCliService._doStop()).resolves.toBeUndefined()
    expect(codeCliService.isStopped).toBe(true)
  })

  it('should prevent double instantiation', async () => {
    const { CodeCliService } = await loadModules()
    // loadModules() already created one instance,
    // so creating another should throw
    expect(() => new CodeCliService()).toThrow(/already been instantiated/)
  })

  // macOS keeps the Claude Code login credential in the global Keychain; existence is probed via
  // `security find-generic-password` WITHOUT `-w` so we never read the secret or trip the ACL prompt.
  it('checkClaudeLogin returns true when the macOS keychain entry exists', async () => {
    const { codeCliService } = await loadModules()
    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(true)
  })

  it('checkClaudeLogin returns false when the macOS keychain lookup fails', async () => {
    const util = await import('util')
    const { codeCliService } = await loadModules()
    // CodeCliService promisifies exec once at module load; grab that resolver and make it reject.
    const execAsync = (
      util.promisify as unknown as { mock: { results: { value: ReturnType<typeof vi.fn> }[] } }
    ).mock.results.at(-1)?.value
    execAsync?.mockRejectedValueOnce(new Error('not found'))
    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(false)
  })

  // Linux/Windows: the credential lives in <CLAUDE_CONFIG_DIR>/.credentials.json. The probe must
  // resolve CLAUDE_CONFIG_DIR from the shell env (what the runtime uses), not raw process.env —
  // a GUI Electron process doesn't inherit rc-exported vars.
  it('checkClaudeLogin (non-mac) probes the shell CLAUDE_CONFIG_DIR', async () => {
    platformMock.isMac = false
    shellEnvMock.getShellEnv.mockResolvedValue({ CLAUDE_CONFIG_DIR: '/home/me/.claude' })
    const fs = (await import('node:fs')).default
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const { codeCliService } = await loadModules()

    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(true)
    expect(fs.existsSync).toHaveBeenCalledWith('/home/me/.claude/.credentials.json')
  })

  // A broken rc file makes the shell env probe throw. That is NOT "not signed
  // in" — it must be logged, not silently swallowed, or a signed-in user is
  // stuck on a "not signed in" card with no diagnostic trail.
  it('checkClaudeLogin (non-mac) logs a warning and returns false when the shell env probe throws', async () => {
    platformMock.isMac = false
    shellEnvMock.getShellEnv.mockRejectedValue(new Error('broken rc file'))

    const { codeCliService } = await loadModules()

    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(false)
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  // A stale/deleted provider must fail the launch outright — previously the
  // lookup failure was swallowed, launching OpenCode with a default provider
  // name ("Studio") that doesn't match the provider key written into
  // opencode.json, while still reporting success.
  describe('run (OpenCode provider resolution)', () => {
    beforeEach(async () => {
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const resolver = await import('@main/utils/binaryResolver')
      vi.mocked(resolver.isBinaryExists).mockResolvedValue(true)
    })

    it('fails the launch instead of defaulting to a wrong provider name', async () => {
      providerServiceMock.getByProviderId.mockImplementation(() => {
        throw new Error('Provider not found: ghost')
      })
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.OPEN_CODE, 'gpt-4o', 'ghost', '/tmp/project')

      expect(result).toEqual({
        success: false,
        message: expect.stringContaining('OpenCode provider not found: ghost')
      })
    })

    // OpenCode is the one CLI that concatenates `model` straight into the launch command, so a model
    // id carrying shell metacharacters ($(), backticks, ;, quotes, spaces) is rejected before the
    // command is ever assembled — it can't inject into the sh -c / AppleScript / .bat string.
    it.each(['gpt-4o; rm -rf ~', 'gpt$(reboot)', 'gpt`whoami`', "gpt'x", 'gpt 4o'])(
      'rejects a model id carrying shell metacharacters (%j)',
      async (badModel) => {
        providerServiceMock.getByProviderId.mockReturnValue({ id: 'deepseek', name: 'DeepSeek' })
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run(CodeCli.OPEN_CODE, badModel, 'deepseek', '/tmp/project')

        expect(result).toEqual({
          success: false,
          message: expect.stringContaining('Unsupported model id')
        })
      }
    )
  })

  // Reviewer A4: the launch directory is interpolated into a shell string (macOS: wrapped again by
  // AppleScript). It must be single-quoted so a path with spaces / $() / backticks can't inject.
  describe('run (launch command shell-quotes the directory)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      // The command-assembly switch branches on the real `process.platform` (separately from the
      // `isMac`/`isWin` mock above, which only governs terminal *config* selection), so it must be
      // pinned to darwin here regardless of the OS actually running the test (e.g. Linux CI).
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const resolver = await import('@main/utils/binaryResolver')
      vi.mocked(resolver.isBinaryExists).mockResolvedValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('single-quotes a directory containing spaces and $() in the assembled command', async () => {
      // Fake timers swallow the terminal-availability probe's 5s race timeouts (nothing the launch
      // awaits depends on them — the mocked probe resolves via microtasks).
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        // loginFlow exempts Claude Code from the provider/model requirement, so control reaches the
        // command assembly + spawn without needing a provider.
        const result = await codeCliService.run(CodeCli.CLAUDE_CODE, '', '', '/tmp/$(reboot) proj', {
          loginFlow: true
        })

        expect(result.success).toBe(true)
        const call = vi.mocked(spawn).mock.calls.at(-1)
        expect(call).toBeDefined()
        const script = (call![1] as string[]).join(' ')
        // posixQuote wraps the directory in single quotes; the Terminal.app adapter then rewrites those
        // quotes to the sh-safe '\'' form for its `osascript -e '…'` layer. Either way $(reboot) sits
        // inside the quotes as inert data — never a substitution.
        expect(script).toContain("cd '\\''/tmp/$(reboot) proj'\\''")
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('run (provider/model validation is owned solely by the service)', () => {
    beforeEach(async () => {
      // Keep the directory guard failing so a launch that passes validation returns immediately
      // (asserting the exemption) instead of proceeding into the slow spawn path.
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(false)
    })

    it('rejects a normal CLI launch when the provider id is empty', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.CLAUDE_CODE, 'gpt-4', '', '/tmp/project')

      expect(result).toEqual({ success: false, message: 'Provider ID is required for claude-code' })
    })

    it('rejects a normal CLI launch when the model is empty', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.CLAUDE_CODE, '', 'openai', '/tmp/project')

      expect(result).toEqual({ success: false, message: 'Model is required for claude-code' })
    })

    it('exempts the Claude login flow from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.CLAUDE_CODE, '', '', '/tmp/project', { loginFlow: true })

      // Validation is skipped for the login flow, so control flows past the provider/model guards to
      // the next check (the directory guard, forced to fail here) — not rejected on provider/model.
      expect(result.message).toContain('Directory does not exist')
    })

    it('exempts providerless CLIs (Qoder) from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.QODER_CLI, '', '', '/tmp/project')

      // Providerless CLIs skip the provider/model guards, so control reaches the directory guard.
      expect(result.message).toContain('Directory does not exist')
    })

    it('exempts an own-login run of a login-capable tool from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.CLAUDE_CODE, '', '', '/tmp/project', { ownLogin: true })

      // ownLogin skips the provider/model guards for login-capable tools, so control reaches the directory guard.
      expect(result.message).toContain('Directory does not exist')
    })

    it('still requires a provider for a non-login-capable tool even when ownLogin is set', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.OPEN_CODE, '', '', '/tmp/project', { ownLogin: true })

      expect(result).toEqual({ success: false, message: 'Provider ID is required for opencode' })
    })
  })
})
