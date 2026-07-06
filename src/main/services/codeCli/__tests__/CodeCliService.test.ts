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

  // Regression: getPackageName (version-registry lookup) and getToolInstallSpec
  // (what actually gets installed) are two independent switches with no compiler
  // link. A scope rename that touches only one silently makes version checks query
  // the wrong npm package — which was the case for Kimi ('kimi-code' vs the
  // installed '@moonshot-ai/kimi-code'). For every tool installed via an explicit
  // `npm:` spec, the two must name the same package.
  it('resolves the version-lookup package name to the installed npm package for every tool', async () => {
    const { codeCliService } = await loadModules()
    const svc = codeCliService as unknown as {
      getPackageName: (cliTool: string) => Promise<string>
      getToolInstallSpec: (cliTool: string) => { name: string; tool: string }
    }
    for (const cliTool of Object.values(CodeCli)) {
      const installTool = svc.getToolInstallSpec(cliTool).tool
      if (!installTool.startsWith('npm:')) continue
      await expect(svc.getPackageName(cliTool)).resolves.toBe(installTool.slice('npm:'.length))
    }
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
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('fails the launch instead of defaulting to a wrong provider name', async () => {
      providerServiceMock.getByProviderId.mockImplementation(() => {
        throw new Error('Provider not found: ghost')
      })
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.OPEN_CODE, 'gpt-4o', 'ghost', '/tmp/project')

      expect(result).toEqual({
        success: false,
        message: expect.stringContaining('OpenCode provider not found: ghost'),
        command: ''
      })
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

      expect(result).toEqual({ success: false, message: 'Provider ID is required for claude-code', command: '' })
    })

    it('rejects a normal CLI launch when the model is empty', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run(CodeCli.CLAUDE_CODE, '', 'openai', '/tmp/project')

      expect(result).toEqual({ success: false, message: 'Model is required for claude-code', command: '' })
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

      expect(result).toEqual({ success: false, message: 'Provider ID is required for opencode', command: '' })
    })
  })
})
