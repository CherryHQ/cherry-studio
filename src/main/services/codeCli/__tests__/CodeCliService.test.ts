import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@main/core/platform', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@main/utils', () => ({
  removeEnvProxy: vi.fn()
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn().mockResolvedValue(false)
}))

vi.mock('@main/utils/process', () => ({
  getBinaryName: vi.fn().mockResolvedValue('bun'),
  getBinaryPath: vi.fn().mockResolvedValue('/mock/bin/tool'),
  isBinaryExists: vi.fn().mockResolvedValue(false)
}))

// Default export is the login-shell env probe; mocked so checkClaudeLogin never execs a real shell.
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({})
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
  // resolve CLAUDE_CONFIG_DIR from the login shell (what the runtime uses), not raw process.env —
  // a GUI Electron process doesn't inherit rc-exported vars.
  it('checkClaudeLogin (non-mac) probes the login-shell CLAUDE_CONFIG_DIR', async () => {
    vi.doMock('@main/core/platform', () => ({ isMac: false, isWin: false }))
    try {
      const shellEnv = (await import('@main/utils/shell-env')).default
      vi.mocked(shellEnv).mockResolvedValue({ CLAUDE_CONFIG_DIR: '/home/me/.claude' })
      const fs = (await import('node:fs')).default
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const { codeCliService } = await loadModules()

      await expect(codeCliService.checkClaudeLogin()).resolves.toBe(true)
      expect(fs.existsSync).toHaveBeenCalledWith('/home/me/.claude/.credentials.json')
    } finally {
      vi.doUnmock('@main/core/platform')
    }
  })
})
