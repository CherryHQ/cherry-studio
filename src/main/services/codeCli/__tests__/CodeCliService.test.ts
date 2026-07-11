import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const binaryManagerMock = vi.hoisted(() => ({
  installTool: vi.fn(() => Promise.resolve({ version: 'latest' })),
  removeTool: vi.fn(() => Promise.resolve()),
  probeSystem: vi.fn(() => Promise.resolve({}))
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'BinaryManager') return binaryManagerMock
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
  // run() awaits the child's spawn/error race before reporting success, so the
  // fake child must emit 'spawn' to its listener.
  spawn: vi.fn(() => ({
    once: (event: string, cb: () => void) => {
      if (event === 'spawn') cb()
    },
    on: () => {}
  })),
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
    binaryManagerMock.probeSystem.mockResolvedValue({})
    binaryManagerMock.installTool.mockResolvedValue({ version: 'latest' })
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

      const result = await codeCliService.run({
        mode: 'normal',
        cliTool: CodeCli.OPEN_CODE,
        model: 'gpt-4o',
        providerId: 'ghost',
        directory: '/tmp/project'
      })

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

        const result = await codeCliService.run({
          mode: 'normal',
          cliTool: CodeCli.OPEN_CODE,
          model: badModel,
          providerId: 'deepseek',
          directory: '/tmp/project'
        })

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

    it('launches a system PATH binary without installing a managed copy', async () => {
      const resolver = await import('@main/utils/binaryResolver')
      vi.mocked(resolver.isBinaryExists).mockResolvedValue(false)
      binaryManagerMock.probeSystem.mockResolvedValue({ claude: '/usr/local/bin/claude' })
      const { spawn } = await import('child_process')
      const { codeCliService } = await loadModules()

      const result = await codeCliService.run({
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: '/tmp/project'
      })

      expect(result.success).toBe(true)
      expect(binaryManagerMock.installTool).not.toHaveBeenCalled()
      expect(binaryManagerMock.probeSystem).toHaveBeenCalledWith(['claude'])
      expect((vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[]).join(' ')).toContain('/usr/local/bin/claude')
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
      const resolver = await import('@main/utils/binaryResolver')
      vi.mocked(resolver.isBinaryExists).mockResolvedValue(true)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('writes a 0600 .bat with %-doubled paths and launches it via the default cmd /c', async () => {
      // Fake timers swallow the terminal-availability probe's 5s race timeouts
      // (the mocked probes resolve via microtasks).
      vi.useFakeTimers()
      try {
        const fs = (await import('node:fs')).default
        const { spawn } = await import('child_process')
        const { codeCliService } = await loadModules()

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
        // The temp script can embed injected credentials via the env prefix; keep it owner-only.
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
  })

  describe('run (linux launch falls back to a detected terminal emulator)', () => {
    const originalPlatform = process.platform

    beforeEach(async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      platformMock.isMac = false
      platformMock.isWin = false
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const resolver = await import('@main/utils/binaryResolver')
      vi.mocked(resolver.isBinaryExists).mockResolvedValue(true)
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
