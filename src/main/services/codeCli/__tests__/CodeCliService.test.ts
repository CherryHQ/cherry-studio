import path from 'node:path'

import type { CodeCliRunInput } from '@shared/ipc/schemas/codeCli'
import type { BinaryRemoveRequest, BinaryRemoveResult } from '@shared/types/binary'
import { CodeCli, TerminalApp } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const binaryManagerMock = vi.hoisted(() => ({
  installByName: vi.fn(() => Promise.resolve()),
  removeTool: vi.fn<(_request: BinaryRemoveRequest) => Promise<BinaryRemoveResult>>(),
  getToolSnapshots: vi.fn()
}))
const hermesDashboardMock = vi.hoisted(() => ({ writeConfigFiles: vi.fn() }))
const antigravityLaunchMock = vi.hoisted(() => vi.fn())
const skillServiceMock = vi.hoisted(() => ({
  syncBuiltinSkill: vi.fn(() => Promise.resolve(false)),
  uninstallBuiltinSkill: vi.fn(() => Promise.resolve(false))
}))

vi.mock('@main/ai/skills/SkillService', () => ({ skillService: skillServiceMock }))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2.0.9'),
    getAppPath: vi.fn(() => '/mock/app'),
    isPackaged: false
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'BinaryManager') return binaryManagerMock
      if (name === 'HermesDashboardService') return hermesDashboardMock
      return {}
    }),
    getPath: vi.fn().mockReturnValue('/mock/binary-data')
  }
}))

vi.mock('../antigravity', () => ({
  prepareAntigravityLaunch: antigravityLaunchMock
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
  getShellEnv: vi.fn(),
  getRawShellEnv: vi.fn()
}))
// Default null = no bundled MinGit, matching a build/host without the Windows bundle.
const bundledGitMock = vi.hoisted(() => ({
  getBundledGitPath: vi.fn(),
  getBundledGitDir: vi.fn()
}))
const childProcessMock = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execAsync: vi.fn().mockResolvedValue({ stdout: '' }),
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '' })
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
  getShellEnv: shellEnvMock.getShellEnv,
  getRawShellEnv: shellEnvMock.getRawShellEnv
}))

vi.mock('@main/utils/bundledGit', () => ({
  getBundledGitPath: bundledGitMock.getBundledGitPath,
  getBundledGitDir: bundledGitMock.getBundledGitDir
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn().mockResolvedValue(false) }
}))

vi.mock('child_process', () => ({
  // run() awaits the child's spawn/error race before reporting success, so the
  // fake child must emit 'spawn' to its listener.
  spawn: vi.fn(() => ({
    once: (event: string, cb: () => void) => {
      if (event === 'spawn') cb()
    },
    on: () => {}
  })),
  exec: childProcessMock.exec,
  execFile: childProcessMock.execFile
}))

vi.mock('util', () => ({
  promisify: vi.fn((fn) =>
    fn === childProcessMock.execFile ? childProcessMock.execFileAsync : childProcessMock.execAsync
  )
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
    shellEnvMock.getRawShellEnv.mockResolvedValue({ PATH: '/usr/local/bin:/usr/bin' })
    bundledGitMock.getBundledGitPath.mockReturnValue(null)
    bundledGitMock.getBundledGitDir.mockReturnValue(null)
    binaryManagerMock.getToolSnapshots.mockImplementation(async (names: string[]) =>
      Object.fromEntries(
        names.map((name) => [
          name,
          {
            name,
            availability: { source: 'mise', path: `/mock/bin/${name}`, version: '1.0.0' }
          }
        ])
      )
    )
    binaryManagerMock.installByName.mockResolvedValue(undefined)
    binaryManagerMock.removeTool.mockResolvedValue({ status: 'removed' })
    skillServiceMock.syncBuiltinSkill.mockResolvedValue(false)
    skillServiceMock.uninstallBuiltinSkill.mockResolvedValue(false)
    hermesDashboardMock.writeConfigFiles.mockResolvedValue(undefined)
    childProcessMock.execAsync.mockResolvedValue({ stdout: '' })
    childProcessMock.execFileAsync.mockResolvedValue({ stdout: '' })
    antigravityLaunchMock.mockResolvedValue({
      secretEnv: {
        path: '/mock/antigravity data/.env',
        names: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']
      },
      geminiDir: '/mock/antigravity data',
      model: 'gemini-2.5-pro'
    })
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

  it('reconciles available CLI skills only after every service is ready', async () => {
    const { codeCliService } = await loadModules()

    await codeCliService._doInit()
    expect(skillServiceMock.syncBuiltinSkill).not.toHaveBeenCalled()

    await codeCliService._doAllReady()
    expect(skillServiceMock.syncBuiltinSkill).toHaveBeenCalledTimes(13)
    expect(skillServiceMock.syncBuiltinSkill).toHaveBeenCalledWith(
      'code-mate-codex',
      path.join('/mock/binary-data', 'code-mate-codex'),
      '2.0.9',
      'code-cli:openai-codex'
    )
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

  describe('CLI skill lifecycle', () => {
    it('installs the bundled skill only after the CLI install succeeds', async () => {
      const { codeCliService } = await loadModules()

      await codeCliService.installCli({ name: 'codex' })

      expect(binaryManagerMock.installByName).toHaveBeenCalledWith({ name: 'codex' })
      expect(skillServiceMock.syncBuiltinSkill).toHaveBeenCalledWith(
        'code-mate-codex',
        path.join('/mock/binary-data', 'code-mate-codex'),
        '2.0.9',
        'code-cli:openai-codex'
      )
    })

    it('does not install a skill when the CLI install fails', async () => {
      binaryManagerMock.installByName.mockRejectedValue(new Error('install failed'))
      const { codeCliService } = await loadModules()

      await expect(codeCliService.installCli({ name: 'codex' })).rejects.toThrow('install failed')

      expect(skillServiceMock.syncBuiltinSkill).not.toHaveBeenCalled()
    })

    it('does not change the skill when binary removal is blocked', async () => {
      binaryManagerMock.removeTool.mockResolvedValue({ status: 'cleanup_blocked', reason: 'conflict' })
      const { codeCliService } = await loadModules()

      await expect(codeCliService.removeCli({ name: 'codex' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'conflict'
      })

      expect(skillServiceMock.syncBuiltinSkill).not.toHaveBeenCalled()
      expect(skillServiceMock.uninstallBuiltinSkill).not.toHaveBeenCalled()
    })

    it('removes the owned skill when no CLI remains after removal', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        codex: { name: 'codex', availability: { source: 'none' }, application: { status: 'absent' } }
      })
      const { codeCliService } = await loadModules()

      await expect(codeCliService.removeCli({ name: 'codex' })).resolves.toEqual({ status: 'removed' })

      expect(skillServiceMock.uninstallBuiltinSkill).toHaveBeenCalledWith('code-mate-codex', 'code-cli:openai-codex')
    })

    it('keeps the skill when a system CLI remains after managed removal', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        codex: { name: 'codex', availability: { source: 'system', path: '/usr/local/bin/codex' } }
      })
      const { codeCliService } = await loadModules()

      await codeCliService.removeCli({ name: 'codex' })

      expect(skillServiceMock.syncBuiltinSkill).toHaveBeenCalled()
      expect(skillServiceMock.uninstallBuiltinSkill).not.toHaveBeenCalled()
    })

    it('preserves the skill when CLI state is unknown', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        codex: {
          name: 'codex',
          availability: { source: 'none' },
          application: { status: 'unknown', reason: 'backend_unavailable' }
        }
      })
      const { codeCliService } = await loadModules()

      await codeCliService.reconcileCliSkills()

      expect(skillServiceMock.syncBuiltinSkill).not.toHaveBeenCalled()
      expect(skillServiceMock.uninstallBuiltinSkill).not.toHaveBeenCalled()
    })
  })

  describe('getAvailableTerminalsForPlatform (macOS)', () => {
    const terminal = expect.objectContaining({ id: TerminalApp.SYSTEM_DEFAULT })
    const ghostty = expect.objectContaining({ id: TerminalApp.GHOSTTY })

    const mockInstalledBundles = (...bundleIds: string[]) => {
      const installed = new Set(bundleIds)
      childProcessMock.execFileAsync.mockImplementation((_file: string, args: string[]) => {
        const bundleId = args.at(-1)
        return Promise.resolve({ stdout: bundleId && installed.has(bundleId) ? `/Applications/${bundleId}.app` : '' })
      })
    }

    it('uses LaunchServices instead of Spotlight to detect installed terminals', async () => {
      childProcessMock.execAsync.mockImplementation((command: string) =>
        Promise.resolve({ stdout: command.includes('com.apple.Terminal') ? '/System/Applications/Terminal.app' : '' })
      )
      mockInstalledBundles('com.mitchellh.ghostty')
      const { codeCliService } = await loadModules()

      await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal, ghostty])
      expect(childProcessMock.execAsync).not.toHaveBeenCalledWith(expect.stringContaining('mdfind'), expect.anything())
    })

    it('omits supported terminals that LaunchServices does not resolve', async () => {
      mockInstalledBundles()
      const { codeCliService } = await loadModules()

      await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal])
    })

    it('keeps the last complete cache when a later probe fails', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-07-14T00:00:00Z'))
        mockInstalledBundles('com.mitchellh.ghostty')
        const { codeCliService } = await loadModules()
        await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal, ghostty])

        vi.advanceTimersByTime(5 * 60 * 1000 + 1)
        childProcessMock.execFileAsync.mockRejectedValue(new Error('LaunchServices unavailable'))

        await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal, ghostty])
      } finally {
        vi.useRealTimers()
      }
    })

    it('retries after an incomplete uncached probe and recovers installed terminals', async () => {
      childProcessMock.execFileAsync.mockRejectedValue(new Error('LaunchServices unavailable'))
      const { codeCliService } = await loadModules()
      await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal])

      mockInstalledBundles('com.mitchellh.ghostty')

      await expect(codeCliService.getAvailableTerminalsForPlatform()).resolves.toEqual([terminal, ghostty])
    })
  })

  // macOS keeps the Claude Code login credential in the global Keychain; existence is probed via
  // `security find-generic-password` WITHOUT `-w` so we never read the secret or trip the ACL prompt.
  it('checkClaudeLogin returns true when the macOS keychain entry exists', async () => {
    const { codeCliService } = await loadModules()
    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(true)
  })

  it('checkClaudeLogin returns false when the macOS keychain lookup fails', async () => {
    const { codeCliService } = await loadModules()
    childProcessMock.execAsync.mockRejectedValueOnce(new Error('not found'))
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

    const path = (await import('node:path')).default

    await expect(codeCliService.checkClaudeLogin()).resolves.toBe(true)
    expect(fs.existsSync).toHaveBeenCalledWith(path.join('/home/me/.claude', '.credentials.json'))
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

  // OpenCode's model selection lives entirely in opencode.json (top-level `model` field
  // written by the config flow) — the launch command must NOT carry a `--model` flag.
  // Previously the flag was assembled from provider name + model id here, which could
  // drift from the provider key written into opencode.json (gateway mode) and made
  // OpenCode reject the model and fall back to its own last-used one.
  describe('run (OpenCode launch)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('launches without --model and disables OpenCode auto-update via env', async () => {
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.OPEN_CODE,
          model: 'deepseek:deepseek-chat',
          providerId: 'cherry-gateway',
          directory: '/tmp/project'
        })

        expect(result.success).toBe(true)
        const call = vi.mocked(spawn).mock.calls.at(-1)
        expect(call).toBeDefined()
        const script = (call![1] as string[]).join(' ')
        expect(script).not.toContain('--model')
        expect(script).toContain('OPENCODE_DISABLE_AUTOUPDATE=')
      } finally {
        vi.useRealTimers()
      }
    })

    it('preserves ambient mise settings for a system OpenCode while exporting its own env', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        opencode: {
          name: 'opencode',
          availability: { source: 'system', path: '/home/me/.local/share/mise/shims/opencode' }
        }
      })
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.OPEN_CODE,
          model: 'deepseek:deepseek-chat',
          providerId: 'cherry-gateway',
          directory: '/tmp/project'
        })

        expect(result.success).toBe(true)
        const call = vi.mocked(spawn).mock.calls.at(-1)
        expect(call).toBeDefined()
        const script = (call![1] as string[]).join(' ')
        expect(script).toContain('OPENCODE_DISABLE_AUTOUPDATE=')
        expect(script).not.toContain('_cherry_mise_key')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // gemini-cli's `resolveModel` rewrites a settings.model.name ending in "flash" to a default Gemini
  // model, so the intended model is passed on the command line at launch — `--model` outranks settings
  // and is honored verbatim — and in gateway mode it must carry the providerId prefix the gateway
  // addresses by plus the @cherry sentinel, or the gateway can't route it.
  describe('run (gemini-cli passes the model via --model)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    const launchScript = async (input: CodeCliRunInput) => {
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()
        const result = await codeCliService.run(input)
        expect(result.success).toBe(true)
        const call = vi.mocked(spawn).mock.calls.at(-1)
        expect(call).toBeDefined()
        return (call![1] as string[]).join(' ')
      } finally {
        vi.useRealTimers()
      }
    }

    it('addresses the model as providerId:modelId plus the sentinel suffix in gateway mode', async () => {
      const script = await launchScript({
        mode: 'normal',
        cliTool: CodeCli.GEMINI_CLI,
        model: 'agent/deepseek-v4-flash',
        providerId: '618d8838-1791-44df-8802-34f8444c0935',
        gateway: true,
        directory: '/tmp/project'
      })
      // The @cherry suffix defeats gemini-cli's model normalization, which rewrites
      // any name satisfying endsWith("flash") to a default Gemini model.
      expect(script).toContain('--model 618d8838-1791-44df-8802-34f8444c0935:agent/deepseek-v4-flash@cherry')
      // The gateway serves only /v1beta, so the launch env forces the SDK's API version — a stale
      // GOOGLE_GENAI_API_VERSION=v1 in the user's shell would otherwise redirect it to /v1. (The
      // value's quotes are backslash-escaped by the AppleScript wrapper, so match the export + value.)
      expect(script).toContain('export GOOGLE_GENAI_API_VERSION=')
      expect(script).toContain('v1beta')
    })

    it('passes the bare model id in direct (non-gateway) mode', async () => {
      const script = await launchScript({
        mode: 'normal',
        cliTool: CodeCli.GEMINI_CLI,
        model: 'gemini-2.5-pro',
        providerId: 'gemini',
        directory: '/tmp/project'
      })
      expect(script).toContain('--model gemini-2.5-pro')
      expect(script).not.toContain('gemini:gemini-2.5-pro')
      // Direct launch must not force the gateway-only API version — a user who set
      // GOOGLE_GENAI_API_VERSION for their own provider keeps it untouched.
      expect(script).not.toContain('GOOGLE_GENAI_API_VERSION')
    })

    it('preserves ambient mise settings for a system Gemini CLI while exporting its own env', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        gemini: { name: 'gemini', availability: { source: 'system', path: '/home/me/.local/share/mise/shims/gemini' } }
      })
      const script = await launchScript({
        mode: 'normal',
        cliTool: CodeCli.GEMINI_CLI,
        model: 'gemini-2.5-pro',
        providerId: 'gemini',
        directory: '/tmp/project'
      })

      expect(script).toContain('GEMINI_CLI_TRUST_WORKSPACE=')
      expect(script).not.toContain('_cherry_mise_key')
    })
  })

  describe('run (Antigravity session configuration)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    const launchScript = async (input: CodeCliRunInput) => {
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()
        const result = await codeCliService.run(input)
        const call = vi.mocked(spawn).mock.calls.at(-1)
        return { result, script: call ? (call[1] as string[]).join(' ') : '' }
      } finally {
        vi.useRealTimers()
      }
    }

    it('quotes the isolated directory and model and imports the credential file instead of its values', async () => {
      const { result, script } = await launchScript({
        mode: 'normal',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        providerId: 'gemini',
        model: 'gemini-2.5-pro',
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      expect(antigravityLaunchMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'gemini', model: 'gemini-2.5-pro' })
      )
      expect(script).toContain("'--gemini_dir=/mock/antigravity data'")
      expect(script).toContain("--model '\\''gemini-2.5-pro'\\''")
      // Terminal.app receives the command through AppleScript, which re-escapes the single quotes.
      expect(script).toContain("done < '\\''/mock/antigravity data/.env'\\''")
      expect(script).toContain('unset GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL')
      expect(script).toContain('${GEMINI_API_KEY+x}')
      expect(script).toContain('${GOOGLE_GEMINI_BASE_URL+x}')
    })

    it.each([TerminalApp.ITERM2, TerminalApp.TABBY])(
      'hands %s the credential file path rather than its contents',
      async (terminal) => {
        childProcessMock.execFileAsync.mockResolvedValue({ stdout: '/Applications/Terminal.app' })
        const { result, script } = await launchScript({
          mode: 'normal',
          cliTool: CodeCli.ANTIGRAVITY_CLI,
          providerId: 'gemini',
          model: 'gemini-2.5-pro',
          directory: '/tmp/project',
          terminal
        })

        expect(result.success).toBe(true)
        expect(script).toContain('/mock/antigravity data/.env')
        expect(script).toContain('unset GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL')
      }
    )

    it('leaves the user Google login and global Antigravity settings untouched in own-login mode', async () => {
      const { result, script } = await launchScript({
        mode: 'own-login',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      expect(antigravityLaunchMock).not.toHaveBeenCalled()
      expect(script).not.toContain('--gemini_dir')
      expect(script).not.toContain('GEMINI_API_KEY')
      expect(script).not.toContain('--model')
    })

    it('rejects an unsafe resolved model before opening a terminal', async () => {
      antigravityLaunchMock.mockResolvedValueOnce({
        secretEnv: { path: '/mock/antigravity/.env', names: ['GEMINI_API_KEY'] },
        geminiDir: '/mock/antigravity',
        model: 'gemini; open /Applications/Calculator.app'
      })

      const { result, script } = await launchScript({
        mode: 'normal',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        providerId: 'gemini',
        model: 'gemini-2.5-pro',
        directory: '/tmp/project'
      })

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected Antigravity launch to fail')
      expect(result.message).toContain('Unsupported model id')
      expect(script).toBe('')
    })
  })

  // Reviewer A4: the launch directory is interpolated into a shell string (macOS: wrapped again by
  // AppleScript). It must be single-quoted so a path with spaces / $() / backticks can't inject.
  // Skipped on win32: `process.platform` is pinned to darwin below, but `node:path` still follows
  // the host, so the assembled command mixes `\` separators and `;` PATH delimiters into sh syntax.
  describe.skipIf(process.platform === 'win32')('run (launch command shell-quotes the directory)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      // The command-assembly switch branches on the real `process.platform` (separately from the
      // `isMac`/`isWin` mock above, which only governs terminal *config* selection), so it must be
      // pinned to darwin here regardless of the OS actually running the test (e.g. Linux CI).
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('launches a system PATH binary without installing a managed copy', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        claude: { name: 'claude', availability: { source: 'system', path: '/usr/local/bin/claude' } }
      })
      const { spawn } = await import('child_process')
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      expect(binaryManagerMock.installByName).not.toHaveBeenCalled()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledWith(['claude'])
      const launchCall = vi.mocked(spawn).mock.calls.at(-1)
      expect(launchCall).toBeDefined()
      const launchArgs = (launchCall?.[1] ?? []).join(' ')
      expect(launchArgs).toContain('/usr/local/bin/claude')
      expect(launchArgs).not.toContain('MISE_DATA_DIR')
    })

    it('single-quotes a system executable path containing shell metacharacters', async () => {
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        claude: {
          name: 'claude',
          availability: { source: 'system', path: '/tmp/$(touch pwned)/`whoami`/claude' }
        }
      })
      const { spawn } = await import('child_process')
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      const launchArgs = (vi.mocked(spawn).mock.calls.at(-1)?.[1] ?? []).join(' ')
      expect(launchArgs).toContain("'\\''/tmp/$(touch pwned)/`whoami`/claude'\\''")
      expect(launchArgs).not.toContain('"/tmp/$(touch pwned)')
    })

    it('lazily recovers a missing CLI by name only, writing no Preference', async () => {
      binaryManagerMock.getToolSnapshots
        .mockResolvedValueOnce({
          claude: { name: 'claude', availability: { source: 'none' } }
        })
        .mockResolvedValueOnce({
          claude: {
            name: 'claude',
            availability: { source: 'mise', path: '/mock/binary-data/shims/claude', version: '1.0.0' }
          }
        })
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      // Name-only lazy install: main resolves the Code CLI's fixed recipe and
      // writes no Preference — the renderer/service never supplies a recipe.
      expect(binaryManagerMock.installByName).toHaveBeenCalledWith({ name: 'claude' })
    })

    it('launches a managed npm CLI with Cherry shims first and no ambient MISE settings', async () => {
      shellEnvMock.getRawShellEnv.mockResolvedValue({
        PATH: '/usr/local/$(touch /tmp/pwn):`whoami`:$HOME:/usr/bin',
        MISE_CONFIG_FILE: '/home/me/.config/mise/config.toml',
        PRIVATE_TOKEN: 'must-not-be-exported'
      })
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        claude: {
          name: 'claude',
          availability: { source: 'mise', path: '/mock/binary-data/shims/claude', version: '1.0.0' }
        }
      })
      const { spawn } = await import('child_process')
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      const launchCall = vi.mocked(spawn).mock.calls.at(-1)!
      const launchArgs = (launchCall[1] ?? []).join(' ')
      const launchEnv = launchCall[2]?.env as Record<string, string>
      expect(launchArgs).toContain(
        "PATH='\\''/mock/binary-data/shims:/mock/binary-data:/usr/local/$(touch /tmp/pwn):`whoami`:$HOME:/usr/bin'\\''"
      )
      expect(launchArgs).toContain("MISE_DATA_DIR='\\''/mock/binary-data'\\''")
      expect(launchArgs).toContain('for _cherry_mise_key in $(env | sed -n')
      expect(launchArgs).toContain('do unset')
      expect(launchArgs).toContain('$_cherry_mise_key')
      expect(launchArgs.indexOf('unset')).toBeLessThan(launchArgs.indexOf('export MISE_DATA_DIR'))
      expect(launchArgs).not.toContain('MISE_CONFIG_FILE')
      expect(launchArgs).not.toContain('PRIVATE_TOKEN')
      expect(launchArgs).not.toContain('must-not-be-exported')
      expect(launchEnv.MISE_CONFIG_FILE).toBeUndefined()
      expect(launchEnv.MISE_DATA_DIR).toBe('/mock/binary-data')
      expect(launchEnv.PRIVATE_TOKEN).toBe('must-not-be-exported')
    })

    it('single-quotes a directory containing spaces and $() in the assembled command', async () => {
      // Fake timers swallow the terminal-availability probe's 5s race timeouts (nothing the launch
      // awaits depends on them — the mocked probe resolves via microtasks).
      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        // The login-flow mode exempts Claude Code from the provider/model requirement, so control
        // reaches the command assembly + spawn without needing a provider.
        const result = await codeCliService.run({
          mode: 'login-flow',
          cliTool: CodeCli.CLAUDE_CODE,
          directory: '/tmp/$(reboot) proj'
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

  describe('run (win32 launch assembles a temp .bat and hands it to the terminal)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      platformMock.isMac = false
      platformMock.isWin = true
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('filters mixed-case ambient MISE variables from the Windows launch environment', async () => {
      shellEnvMock.getRawShellEnv.mockResolvedValue({
        Path: 'C:\\Windows\\System32',
        Mise_Global_Config_File: 'C:\\Users\\me\\mise.toml'
      })
      const { spawn } = await import('child_process')
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: 'C:\\Users\\me\\project'
      })

      expect(result.success).toBe(true)
      const launchEnv = vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env as Record<string, string>
      expect(launchEnv.Mise_Global_Config_File).toBeUndefined()
      expect(launchEnv.MISE_DATA_DIR).toBe('/mock/binary-data')
    })

    it('writes a 0600 .bat with %-doubled paths and launches it via the default cmd /c', async () => {
      // Fake timers swallow the terminal-availability probe's 5s race timeouts
      // (the mocked probes resolve via microtasks).
      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        binaryManagerMock.getToolSnapshots.mockResolvedValue({
          claude: {
            name: 'claude',
            availability: { source: 'mise', path: 'C:\\Tools\\100% cli\\claude.exe', version: '1.0.0' }
          }
        })

        const result = await codeCliService.run({
          mode: 'login-flow',
          cliTool: CodeCli.CLAUDE_CODE,
          directory: 'C:\\Users\\me\\100% proj'
        })

        expect(result.success).toBe(true)

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls.at(-1)
        expect(writeCall).toBeDefined()
        const [batPath, batContent] = writeCall! as unknown as [string, string]
        expect(batPath).toMatch(/launch_claude-code_\d+\.bat$/)
        // CMD expands %…% even inside double quotes, so the bat writer must double them.
        expect(batContent).toContain('if not exist "C:\\Users\\me\\100%% proj" goto :dir_missing')
        expect(batContent).toContain('pushd "C:\\Users\\me\\100%% proj"')
        // The executable path crosses the same boundary as the directory paths.
        expect(batContent).toContain('"C:\\Tools\\100%% cli\\claude.exe"')
        // Paths may still be sensitive even though credentials no longer enter this file.
        expect(vi.mocked(fs.chmodSync)).toHaveBeenCalledWith(batPath, 0o600)

        const launch = vi.mocked(spawn).mock.calls.at(-1)
        expect(launch).toBeDefined()
        expect(launch![0]).toBe('cmd')
        expect(launch![1]).toEqual(['/c', batPath])
        expect(launch![2]).toMatchObject({ shell: true, detached: true })
      } finally {
        vi.useRealTimers()
      }
    })

    it('%-doubles Antigravity arguments and the credential file path in the .bat', async () => {
      antigravityLaunchMock.mockResolvedValueOnce({
        secretEnv: {
          path: 'C:\\Users\\me\\100% data\\Antigravity\\.env',
          names: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL']
        },
        geminiDir: 'C:\\Users\\me\\100% data\\Antigravity',
        model: 'gemini-api://618d8838/models/gemini-2.5-pro'
      })

      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.ANTIGRAVITY_CLI,
          providerId: 'cherry-api-gateway',
          model: 'gemini-2.5-pro',
          directory: 'C:\\Users\\me\\project'
        })

        expect(result.success).toBe(true)
        const [, batContent] = vi.mocked(fs.writeFileSync).mock.calls.at(-1)! as unknown as [string, string]
        // CMD expands %…% even inside double quotes, so the isolated dir must be %-doubled
        // or the CLI lands on a truncated --gemini_dir and rewrites the wrong settings.json.
        expect(batContent).toContain('"--gemini_dir=C:\\Users\\me\\100%% data\\Antigravity"')
        // The gateway address carries `://` and `/models/`; the route parses it back into
        // `providerId:apiModelId`, so quoting must not mangle or split it.
        expect(batContent).toContain('--model "gemini-api://618d8838/models/gemini-2.5-pro"')
        // The credential file path crosses the same %-expansion boundary as the other paths.
        expect(batContent).toContain(
          'for /f "usebackq tokens=1,* delims==" %%a in ("C:\\Users\\me\\100%% data\\Antigravity\\.env") do set "%%a=%%b"'
        )
      } finally {
        vi.useRealTimers()
      }
    })

    // An ambient GEMINI_API_KEY in the user's environment must not satisfy the guard, and the CLI
    // must not start when the credential file could not be loaded.
    it('clears ambient values, imports the credential file, and aborts when a variable is still missing', async () => {
      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.ANTIGRAVITY_CLI,
          providerId: 'gemini',
          model: 'gemini-2.5-pro',
          directory: 'C:\\Users\\me\\project',
          terminal: TerminalApp.WINDOWS_TERMINAL
        })

        expect(result.success).toBe(true)
        const [, batContent] = vi.mocked(fs.writeFileSync).mock.calls.at(-1)! as unknown as [string, string]
        const clearIndex = batContent.indexOf('set "GEMINI_API_KEY="')
        const importIndex = batContent.indexOf(
          'for /f "usebackq tokens=1,* delims==" %%a in ("/mock/antigravity data/.env") do set "%%a=%%b"'
        )
        const guardIndex = batContent.indexOf('if not defined GEMINI_API_KEY goto :secret_env_missing')
        expect(clearIndex).toBeGreaterThan(-1)
        expect(clearIndex).toBeLessThan(importIndex)
        expect(importIndex).toBeLessThan(guardIndex)
        expect(guardIndex).toBeLessThan(batContent.indexOf('--gemini_dir='))
        expect(batContent).toContain('if not defined GOOGLE_GEMINI_BASE_URL goto :secret_env_missing')
        // The failure branch exits instead of falling through into the launch.
        expect(batContent.slice(batContent.indexOf(':secret_env_missing'))).toContain('exit /b 1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('hands WSL the same .bat, so no credential has to cross the Windows/WSL environment boundary', async () => {
      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.ANTIGRAVITY_CLI,
          providerId: 'gemini',
          model: 'gemini-2.5-pro',
          directory: 'C:\\Users\\me\\project',
          terminal: TerminalApp.WSL
        })

        expect(result.success).toBe(true)
        const launch = vi.mocked(spawn).mock.calls.at(-1)!
        expect(launch[0]).toBe('wsl')
        expect((launch[1] as string[]).join(' ')).not.toContain('GEMINI_API_KEY')
        const batContent = vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string
        expect(batContent).toContain('in ("/mock/antigravity data/.env") do set "%%a=%%b"')
      } finally {
        vi.useRealTimers()
      }
    })

    it('includes cherry.bin and appends the bundled MinGit dir to a managed launch PATH tail (#16402)', async () => {
      // Regression (PR #16402 review): the launch env must carry the bundled
      // git dir at the very tail so a terminal-launched CLI resolves a bare
      // `git` on a machine without system git, while any real git ahead wins.
      const gitDir = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd'
      bundledGitMock.getBundledGitDir.mockReturnValue(gitDir)
      shellEnvMock.getRawShellEnv.mockResolvedValue({ Path: 'C:\\Windows\\System32' })

      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'login-flow',
          cliTool: CodeCli.CLAUDE_CODE,
          directory: 'C:\\Users\\me\\proj'
        })

        expect(result.success).toBe(true)
        const spawnEnv = (vi.mocked(spawn).mock.calls.at(-1)![2] as { env: Record<string, string> }).env
        expect(spawnEnv.Path.split(';')).toContain('/mock/binary-data')
        expect(spawnEnv.Path.split(';').at(-1)).toBe(gitDir)
        expect(spawnEnv.Path).toContain('C:\\Windows\\System32')
        // The bat rewrites PATH inside the terminal, so the tail must be in the
        // env prefix too, not only in the spawn env.
        const batContent = vi.mocked(fs.writeFileSync).mock.calls.at(-1)![1] as string
        expect(batContent).toContain(gitDir)
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives a system CLI only the git tail — no Cherry MISE_* redirection', async () => {
      const gitDir = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd'
      bundledGitMock.getBundledGitDir.mockReturnValue(gitDir)
      shellEnvMock.getRawShellEnv.mockResolvedValue({
        Path: 'C:\\Windows\\System32',
        MISE_DATA_DIR: 'C:\\Users\\me\\mise-data'
      })
      binaryManagerMock.getToolSnapshots.mockResolvedValue({
        claude: { name: 'claude', availability: { source: 'system', path: 'C:\\Tools\\claude.exe' } }
      })

      vi.useFakeTimers()
      try {
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

        const result = await codeCliService.run({
          mode: 'login-flow',
          cliTool: CodeCli.CLAUDE_CODE,
          directory: 'C:\\Users\\me\\proj'
        })

        expect(result.success).toBe(true)
        const spawnEnv = (vi.mocked(spawn).mock.calls.at(-1)![2] as { env: Record<string, string> }).env
        expect(spawnEnv.Path.split(';').at(-1)).toBe(gitDir)
        // The user's own mise settings pass through untouched; Cherry's isolated
        // MISE_DATA_DIR must never redirect a system CLI's shims.
        expect(spawnEnv.MISE_DATA_DIR).toBe('C:\\Users\\me\\mise-data')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('run (linux launch falls back to a detected terminal emulator)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      platformMock.isMac = false
      platformMock.isWin = false
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
    })

    afterEach(async () => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      // Restore the module-level default spawn stub (the mock instance is shared across tests).
      const { spawn } = await import('child_process')
      vi.mocked(spawn).mockImplementation((() => ({
        once: (event: string, cb: () => void) => {
          if (event === 'spawn') cb()
        },
        on: () => {}
      })) as never)
    })

    /** `which` probes report only `hits` as found; the final launch spawn emits 'spawn'. */
    async function mockLinuxSpawn(hits: string[]) {
      const { spawn } = await import('child_process')
      vi.mocked(spawn).mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === 'which') {
          return {
            on: (event: string, cb: (code: number) => void) => {
              if (event === 'close') cb(hits.includes(args[0]) ? 0 : 1)
            }
          }
        }
        return {
          once: (event: string, cb: () => void) => {
            if (event === 'spawn') cb()
          },
          on: () => {}
        }
      }) as never)
      return spawn
    }

    it('probes with `which` and launches the first detected terminal (gnome-terminal)', async () => {
      const spawn = await mockLinuxSpawn(['gnome-terminal'])
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/home/me/proj'
      })

      expect(result.success).toBe(true)
      const launch = vi.mocked(spawn).mock.calls.at(-1)
      expect(launch).toBeDefined()
      expect(launch![0]).toBe('gnome-terminal')
      expect(launch![1]).toEqual([
        '--working-directory',
        '/home/me/proj',
        '--',
        'bash',
        '-c',
        expect.stringContaining('clear && ')
      ])
      expect(launch![2]).toMatchObject({ shell: false, detached: true })
    })

    it('uses xdg-terminal-exec to respect the configured default terminal', async () => {
      const spawn = await mockLinuxSpawn(['xdg-terminal-exec', 'gnome-terminal'])
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/home/me/my project'
      })

      expect(result.success).toBe(true)
      const launch = vi.mocked(spawn).mock.calls.at(-1)
      expect(launch?.[0]).toBe('xdg-terminal-exec')
      expect(launch?.[1]).toEqual([
        '--dir=/home/me/my project',
        '--',
        'bash',
        '-c',
        expect.stringContaining('clear && ')
      ])
    })

    it('prefers x-terminal-emulator over xterm', async () => {
      const spawn = await mockLinuxSpawn(['x-terminal-emulator', 'xterm'])
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/home/me/proj'
      })

      expect(result.success).toBe(true)
      const launch = vi.mocked(spawn).mock.calls.at(-1)
      expect(launch?.[0]).toBe('x-terminal-emulator')
      expect(launch?.[1]).toEqual(['-e', 'bash', '-c', expect.stringContaining("cd '/home/me/proj' && clear && ")])
    })

    it('reports a failed launch when the terminal process errors at spawn', async () => {
      const { spawn } = await import('child_process')
      vi.mocked(spawn).mockImplementation(((cmd: string) => {
        if (cmd === 'which') {
          return {
            on: (event: string, cb: (code: number) => void) => {
              if (event === 'close') cb(1)
            }
          }
        }
        // The launch child fails asynchronously (ENOENT for the missing fallback
        // terminal); run() must lose the spawn/error race and report failure.
        return {
          once: (event: string, cb: (err?: Error) => void) => {
            if (event === 'error') cb(new Error('spawn xterm ENOENT'))
          },
          on: () => {}
        }
      }) as never)

      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/home/me/proj'
      })

      expect(result).toEqual({
        success: false,
        message: expect.stringContaining('Failed to launch terminal: spawn xterm ENOENT')
      })
    })

    it('defaults to xterm with a shell-quoted directory when no emulator is detected', async () => {
      const spawn = await mockLinuxSpawn([])
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/home/me/my proj'
      })

      expect(result.success).toBe(true)
      const launch = vi.mocked(spawn).mock.calls.at(-1)
      expect(launch).toBeDefined()
      expect(launch![0]).toBe('xterm')
      // posixQuote keeps the spaced directory a single shell token inside -e.
      expect((launch![1] as string[]).join(' ')).toContain("cd '/home/me/my proj' && clear")
    })
  })

  describe('writeConfigFiles', () => {
    it('delegates Hermes config writes to the Dashboard lifecycle lock', async () => {
      const { codeCliService } = await loadModules()

      await codeCliService.writeConfigFiles(CodeCli.HERMES, [{ target: 'hermes-config', content: 'model: {}\n' }])

      expect(hermesDashboardMock.writeConfigFiles).toHaveBeenCalledOnce()
      expect(hermesDashboardMock.writeConfigFiles).toHaveBeenCalledWith(expect.any(Function))
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

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.CLAUDE_CODE,
        model: 'gpt-4',
        providerId: '',
        directory: '/tmp/project'
      })

      expect(result).toEqual({ success: false, message: 'Provider ID is required for claude-code' })
    })

    it('routes DeepSeek Harness launches through its managed IPC instead of a terminal', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.DEEPSEEK_HARNESS,
        model: 'claude-sonnet',
        providerId: 'anthropic',
        directory: '/tmp/project'
      })

      expect(result).toEqual({
        success: false,
        message: 'DeepSeek Harness is managed through deepseek_harness.* IPC, not code_cli.run'
      })
    })

    it('routes Hermes Agent launches through its managed IPC instead of a terminal', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.HERMES,
        model: 'hermes-3',
        providerId: 'deepseek',
        directory: '/tmp/project'
      })

      expect(result).toEqual({
        success: false,
        message: 'Hermes Agent is managed through hermes_dashboard.* IPC, not code_cli.run'
      })
      expect(binaryManagerMock.getToolSnapshots).not.toHaveBeenCalled()
    })

    it('rejects a normal CLI launch when the model is empty', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.CLAUDE_CODE,
        model: '',
        providerId: 'openai',
        directory: '/tmp/project'
      })

      expect(result).toEqual({ success: false, message: 'Model is required for claude-code' })
    })

    it('requires a provider for a normal Pi launch', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.PI,
        model: 'gpt-5',
        providerId: '',
        directory: '/tmp/project'
      })

      expect(result).toEqual({ success: false, message: 'Provider ID is required for pi' })
    })

    it('exempts the Claude login flow from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      // Validation is skipped for the login flow, so control flows past the provider/model guards to
      // the next check (the directory guard, forced to fail here) — not rejected on provider/model.
      expect(result).toEqual({ success: false, message: expect.stringContaining('Directory does not exist') })
    })

    it('exempts providerless CLIs (Qoder) from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'own-login',
        cliTool: CodeCli.QODER_CLI,
        directory: '/tmp/project'
      })

      // Providerless CLIs skip the provider/model guards, so control reaches the directory guard.
      expect(result).toEqual({ success: false, message: expect.stringContaining('Directory does not exist') })
    })

    it('exempts an own-login run of a login-capable tool from the provider/model requirement', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'own-login',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      // The own-login mode skips the provider/model guards for login-capable tools, so control
      // reaches the directory guard.
      expect(result).toEqual({ success: false, message: expect.stringContaining('Directory does not exist') })
    })

    it('still requires a provider for a non-login-capable tool even in own-login mode', async () => {
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'own-login',
        cliTool: CodeCli.OPEN_CODE,
        directory: '/tmp/project'
      })

      expect(result).toEqual({ success: false, message: 'Provider ID is required for opencode' })
    })
  })
})
