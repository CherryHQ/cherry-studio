import type * as LifecycleModule from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs, mockPreferenceService } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFs: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(() => '/tmp/cherry-mise-test'),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    constants: { F_OK: 0, X_OK: 1 }
  },
  mockPreferenceService: {
    // Keyed so buildIsolatedEnv reads a well-formed install_settings object
    // (verifySignatures:true by default) rather than the `[]` fallback, which
    // would make !verifySignatures truthy and spuriously disable aqua checks.
    get: vi.fn((key: string) =>
      key === 'feature.binary.install_settings'
        ? { githubMirror: '', githubToken: '', npmRegistry: '', pipIndexUrl: '', verifySignatures: true }
        : []
    ),
    subscribeMultipleChanges: vi.fn(() => ({ dispose: vi.fn() }))
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: mockPreferenceService
  })
})

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

vi.mock('node:fs', () => ({ default: mockFs }))

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => {}),
    copyFile: vi.fn(async () => {}),
    chmod: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    access: vi.fn(async () => {})
  }
}))

vi.mock('node:os', () => ({
  default: { tmpdir: () => '/tmp' }
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error('not found')
  })
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn().mockResolvedValue(false) }
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

const { BinaryManager, validateManagedBinary } = await import('../BinaryManager')
const { MockMainCacheServiceUtils } = await import('@test-mocks/main/CacheService')
const { getBinaryExecutionEnv, getBinaryIsolatedHomeEnv } = await import('@main/utils/binaryEnv')

describe('binary execution env split', () => {
  // The shared execution env runs the launched CLIs (claude/codex/gemini/qwen)
  // and the OpenClaw gateway — it MUST keep the user's real HOME so they find
  // their config/creds. HOME/XDG relocation belongs only to the install subprocess.
  it('getBinaryExecutionEnv does not relocate HOME/XDG', () => {
    const env = getBinaryExecutionEnv()
    expect(env['HOME']).toBeUndefined()
    expect(env['XDG_CONFIG_HOME']).toBeUndefined()
    expect(env['XDG_CACHE_HOME']).toBeUndefined()
    expect(env['XDG_STATE_HOME']).toBeUndefined()
    // Shims still resolve against Cherry's isolated mise data dir.
    expect(env['MISE_DATA_DIR']).toBe('/mock/feature.binary.data')
  })

  it('getBinaryIsolatedHomeEnv relocates HOME/XDG into the data dir', () => {
    const env = getBinaryIsolatedHomeEnv()
    expect(env['HOME']).toBe('/mock/feature.binary.data/home')
    expect(env['XDG_CONFIG_HOME']).toBe('/mock/feature.binary.data/xdg/config')
  })
})

describe('BinaryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainCacheServiceUtils.resetMocks()
    mockExecFileAsync.mockReset()
    mockFs.existsSync.mockReset().mockReturnValue(false)
    mockFs.readFileSync.mockReset()
    // Restore the keyed default so a per-test override can't leak forward
    // (clearAllMocks wipes call history but keeps mockImplementation overrides).
    mockPreferenceService.get.mockImplementation((key: string) =>
      key === 'feature.binary.install_settings' ? { ...DEFAULT_INSTALL_SETTINGS } : []
    )
    mockPreferenceService.subscribeMultipleChanges.mockReturnValue({ dispose: vi.fn() })
  })

  // Mirrors the generated default for feature.binary.install_settings; tests
  // spread over it to vary one field at a time.
  const DEFAULT_INSTALL_SETTINGS = {
    githubMirror: '',
    githubToken: '',
    npmRegistry: '',
    pipIndexUrl: '',
    verifySignatures: true
  }
  const setInstallSettings = (partial: Partial<typeof DEFAULT_INSTALL_SETTINGS>) =>
    mockPreferenceService.get.mockImplementation((key: string) =>
      key === 'feature.binary.install_settings' ? { ...DEFAULT_INSTALL_SETTINGS, ...partial } : []
    )

  describe('decorators', () => {
    it('is registered as Background phase', () => {
      expect(getPhase(BinaryManager)).toBe(Phase.Background)
    })
  })

  describe('reconcile', () => {
    it('returns error when mise binary is not available', async () => {
      const service = new BinaryManager()

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('*')
      expect(result.installed).toHaveLength(0)
    })

    it('skips tools that are already at the target version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('skips unpinned tools that are already installed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
    })

    it('reinstalls when tool spec changes', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
          }
        })
      )

      // spec mismatch short-circuits the skip-path readiness check, so the only
      // `which` call is the post-install one verifying the tool is runnable.
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ 'github:other-org/fd': [{ version: '2.0.0' }] }),
          stderr: ''
        }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (post-install ready check)

      const result = await service.reconcile([{ name: 'fd', tool: 'github:other-org/fd', version: '2.0.0' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.skipped).toHaveLength(0)
    })

    it('handles install failure gracefully', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync.mockRejectedValueOnce(new Error('mise use failed'))

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('fd')
      expect(result.failed[0].error).toContain('mise use failed')
      expect(result.installed).toHaveLength(0)
    })

    it('installs multiple tools and records state', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim fd
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use rg
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim rg
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ 'github:BurntSushi/ripgrep': [{ version: '15.0.0' }] }),
          stderr: ''
        }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/rg\n', stderr: '' }) // which rg (ready check)

      const result = await service.reconcile([
        { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' },
        { name: 'rg', tool: 'github:BurntSushi/ripgrep', version: '15.0.0' }
      ])

      expect(result.installed).toEqual(['fd', 'rg'])
      expect(result.failed).toHaveLength(0)

      expect(mockFs.writeFileSync).toHaveBeenCalled()
      const lastWriteCall = mockFs.writeFileSync.mock.calls.at(-1)!
      const savedState = JSON.parse(lastWriteCall[1])
      expect(savedState.tools.fd.version).toBe('10.0.0')
      expect(savedState.tools.rg.version).toBe('15.0.0')
    })

    it('marks a tool as failed (not installed) when it is not runnable after install', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // which fd -> empty -> not runnable

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.installed).toHaveLength(0)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('fd')
      expect(result.failed[0].error).toContain('not runnable')
    })

    it('skips a leading-v pin that matches the stored bare version (normalized compare)', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ tools: { fd: { tool: 'github:sharkdp/fd', version: '1.2.3' } } })
      )

      mockExecFileAsync.mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready)

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: 'v1.2.3' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
    })

    it('upgrades when a leading-v pin resolves higher than the stored version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ tools: { fd: { tool: 'github:sharkdp/fd', version: '1.2.2' } } })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (skip-path ready check)
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '1.2.3' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (post-install ready)

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: 'v1.2.3' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.skipped).toHaveLength(0)
      const savedState = JSON.parse(mockFs.writeFileSync.mock.calls.at(-1)![1])
      expect(savedState.tools.fd.version).toBe('1.2.3')
    })
  })

  describe('removeTool', () => {
    it('removes tool from state', async () => {
      const service = new BinaryManager()

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
          }
        })
      )

      await service.removeTool('fd')

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()

      const lastWriteCall = mockFs.writeFileSync.mock.calls.at(-1)!
      const savedState = JSON.parse(lastWriteCall[1])
      expect(savedState.tools.fd).toBeUndefined()
    })

    it('uninstalls mise versions so the isolated data dir does not accumulate', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
          }
        })
      )
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      await service.removeTool('fd')

      const miseArgs = mockExecFileAsync.mock.calls.map((c: any[]) => c[1])
      expect(miseArgs).toContainEqual(['unuse', '-g', 'github:sharkdp/fd'])
      expect(miseArgs).toContainEqual(['uninstall', '--all', 'github:sharkdp/fd'])
    })

    it('succeeds even if binary does not exist on disk', async () => {
      const service = new BinaryManager()

      mockFs.existsSync.mockReturnValue(false)
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      await service.removeTool('nonexistent')

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('installTool', () => {
    it('throws when mise binary is not available', async () => {
      const service = new BinaryManager()

      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).rejects.toThrow(
        'Binary backend not available'
      )
    })

    it('installs and returns version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })

      expect(result.version).toBe('10.0.0')
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockFs.chmodSync).not.toHaveBeenCalled()
    })

    it('throws and does not persist state when the binary is not runnable after install', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // which fd -> empty -> not runnable

      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).rejects.toThrow(
        'not runnable'
      )
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('searchRegistry', () => {
    it('returns empty array when mise binary is not available', async () => {
      const service = new BinaryManager()
      const result = await service.searchRegistry('fd')
      expect(result).toEqual([])
    })

    it('caches registry output across calls', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          { short: 'fd', backends: ['github:sharkdp/fd'] },
          { short: 'rg', backends: ['github:BurntSushi/ripgrep'] }
        ]),
        stderr: ''
      })

      await service.searchRegistry('fd')
      await service.searchRegistry('rg')

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1)
    })

    it('rejects when the registry command fails (e.g. mise too old for --json)', async () => {
      // Must propagate, not swallow to []: the renderer's search-error UI only
      // fires on the IPC rejection; a resolved [] would render as a silently
      // empty dropdown reading "no such tool".
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync.mockRejectedValue(new Error('unexpected argument --json'))

      await expect(service.searchRegistry('fd')).rejects.toThrow('unexpected argument --json')
    })

    it('rejects when the registry returns malformed JSON', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync.mockResolvedValue({ stdout: 'not json', stderr: '' })

      await expect(service.searchRegistry('fd')).rejects.toThrow()
    })
  })

  describe('getLatestVersions', () => {
    const setupManaged = (tools: Record<string, { tool: string; version: string }>) => {
      mockFs.readFileSync.mockImplementation(() => JSON.stringify({ tools }))
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      return service
    }

    const latestCalls = () =>
      mockExecFileAsync.mock.calls.filter((c: any[]) => c[1]?.[0] === 'latest').map((c: any[]) => c[1])

    it('returns empty map when mise binary is not available', async () => {
      const service = new BinaryManager()

      const result = await service.getLatestVersions()

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns the shared cache snapshot without running mise when force is false', async () => {
      MockMainCacheServiceUtils.setSharedCacheValue('feature.binary.latest_versions', { fd: '10.1.0' })
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })

      const result = await service.getLatestVersions()

      expect(result).toEqual({ fd: '10.1.0' })
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map on cache miss when force is false without running mise', async () => {
      const service = setupManaged({
        fd: { tool: 'github:sharkdp/fd', version: '10.0.0' }
      })

      const result = await service.getLatestVersions()

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map when no tools are managed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('queries the latest version for every managed tool via mise latest', async () => {
      const service = setupManaged({
        fd: { tool: 'github:sharkdp/fd', version: '10.0.0' },
        rg: { tool: 'github:BurntSushi/ripgrep', version: '15.0.0' }
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'latest')
          return { stdout: `${args[1] === 'github:sharkdp/fd' ? '10.1.0' : '15.1.0'}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ fd: '10.1.0', rg: '15.1.0' })
      expect(latestCalls()).toContainEqual(['latest', 'github:sharkdp/fd'])
      expect(latestCalls()).toContainEqual(['latest', 'github:BurntSushi/ripgrep'])
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0',
        rg: '15.1.0'
      })
    })

    it('omits tools whose latest-version lookup fails', async () => {
      const service = setupManaged({
        fd: { tool: 'github:sharkdp/fd', version: '10.0.0' },
        rg: { tool: 'github:BurntSushi/ripgrep', version: '15.0.0' }
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] !== 'latest') return { stdout: '', stderr: '' }
        if (args[1] === 'github:BurntSushi/ripgrep') throw new Error('rate limited')
        return { stdout: '10.1.0\n', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      // Failed lookup is omitted, not reported as an error.
      expect(result).toEqual({ fd: '10.1.0' })
    })

    it('stores the result in shared cache so the second non-force call reads it without re-running mise latest', async () => {
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })

      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })
      const callsAfterFirst = latestCalls().length

      await service.getLatestVersions()
      expect(latestCalls().length).toBe(callsAfterFirst)
    })

    it('re-runs mise latest when force is true even with a shared cache snapshot', async () => {
      MockMainCacheServiceUtils.setSharedCacheValue('feature.binary.latest_versions', { fd: '10.0.5' })
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })

      const callsBefore = latestCalls().length
      await service.getLatestVersions(true)
      expect(latestCalls().length).toBeGreaterThan(callsBefore)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })
    })

    it('clears the shared cache on state mutation so the next non-force call is empty', async () => {
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })

      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })

      ;(service as any).saveState({ tools: { fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } } })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toBeUndefined()

      const callsAfterFirst = latestCalls().length
      const cached = await service.getLatestVersions()
      expect(cached).toEqual({})
      expect(latestCalls().length).toBe(callsAfterFirst)
    })

    it('deduplicates concurrent forced latest-version checks', async () => {
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })
      mockExecFileAsync.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return { stdout: '10.1.0\n', stderr: '' }
      })

      const [first, second] = await Promise.all([service.getLatestVersions(true), service.getLatestVersions(true)])

      expect(first).toEqual({ fd: '10.1.0' })
      expect(second).toEqual({ fd: '10.1.0' })
      expect(latestCalls()).toHaveLength(1)
    })

    it('drops the result when the managed set changes during the batch (race guard)', async () => {
      const service = setupManaged({ fd: { tool: 'github:sharkdp/fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })
      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })

      const setSharedAfterFirst = MockMainCacheServiceUtils.getMockCallCounts().setShared

      mockExecFileAsync.mockImplementationOnce(async () => {
        mockFs.readFileSync.mockReturnValue(
          JSON.stringify({
            tools: {
              fd: { tool: 'github:sharkdp/fd', version: '10.0.0' },
              rg: { tool: 'github:BurntSushi/ripgrep', version: '15.0.0' }
            }
          })
        )
        return { stdout: '10.1.0\n', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(setSharedAfterFirst)
    })
  })

  describe('validateManagedBinary', () => {
    it.each([
      ['../etc', 'fd', undefined],
      ['', 'fd', undefined],
      ['fd; rm -rf /', 'fd', undefined],
      ['fd\x00', 'fd', undefined],
      ['123fd', 'fd', undefined]
    ])('rejects invalid tool name=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool name')
    })

    it.each([
      ['fd', '', undefined],
      ['fd', 'tool; echo', undefined],
      ['fd', 'tool name', undefined],
      ['fd', '../../../etc/passwd', undefined],
      ['fd', 'github://evil', undefined],
      ['fd', '--verbose', undefined]
    ])('rejects invalid tool key=%j tool=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool key')
    })

    it.each([
      ['fd', 'fd', 'version; echo'],
      ['fd', 'fd', 'ver sion'],
      ['fd', 'fd', '-rf']
    ])('rejects invalid version=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool version')
    })

    it('accepts valid tool definitions', () => {
      expect(() => validateManagedBinary({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).not.toThrow()
      expect(() => validateManagedBinary({ name: 'ntn', tool: 'npm:ntn' })).not.toThrow()
      expect(() => validateManagedBinary({ name: 'hermes', tool: 'pipx:hermes-agent' })).not.toThrow()
    })
  })

  describe('buildIsolatedEnv', () => {
    it('filters out non-whitelisted environment variables', async () => {
      const original = { ...process.env }
      try {
        process.env['AWS_ACCESS_KEY_ID'] = 'test-key'
        process.env['OPENAI_API_KEY'] = 'sk-test'
        process.env['SECRET_TOKEN'] = 'secret'

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined()
        expect(env['OPENAI_API_KEY']).toBeUndefined()
        expect(env['SECRET_TOKEN']).toBeUndefined()
        expect(env['MISE_DATA_DIR']).toBeDefined()
      } finally {
        process.env = original
      }
    })

    it('passes through whitelisted variables but not the ambient auth token', async () => {
      const original = { ...process.env }
      try {
        process.env['GITHUB_TOKEN'] = 'ghp_test'
        process.env['HTTPS_PROXY'] = 'http://proxy:8080'
        delete process.env['CHERRY_GITHUB_TOKEN']

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['HTTPS_PROXY']).toBe('http://proxy:8080')
        // Ambient GITHUB_TOKEN is intentionally not forwarded.
        expect(env['GITHUB_TOKEN']).toBeUndefined()
      } finally {
        process.env = original
      }
    })

    it('forwards CHERRY_GITHUB_TOKEN as GITHUB_TOKEN to raise the GitHub API rate limit', async () => {
      const original = { ...process.env }
      try {
        process.env['CHERRY_GITHUB_TOKEN'] = 'ghp_opt_in'
        process.env['GITHUB_TOKEN'] = 'ghp_ambient_should_be_ignored'

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['GITHUB_TOKEN']).toBe('ghp_opt_in')
      } finally {
        process.env = original
      }
    })

    it('composes PATH as mise shims → mise dir → inherited PATH, in that order', async () => {
      // Pins the extraPathPrefixes contract: buildIsolatedEnv folds its
      // [MISE_SHIMS_DIR, miseDir, existing] merge into mergeBinaryExecutionEnv,
      // and the shims-first / mise-dir-second ordering is load-bearing so a
      // re-exec'd child mise resolves against the isolated shims.
      const original = { ...process.env }
      try {
        process.env['PATH'] = '/usr/bin:/bin'
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/bin/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['PATH'].split(':')).toEqual(['/mock/feature.binary.data/shims', '/mock/bin', '/usr/bin', '/bin'])
      } finally {
        process.env = original
      }
    })

    it('relocates HOME/XDG into the isolated data dir so mise cannot read user-level config/creds', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const env = await (service as any).buildIsolatedEnv()

      // Install subprocess MUST be isolated from the user's real home.
      expect(env['HOME']).toBe('/mock/feature.binary.data/home')
      expect(env['XDG_CONFIG_HOME']).toBe('/mock/feature.binary.data/xdg/config')
      expect(env['XDG_CACHE_HOME']).toBe('/mock/feature.binary.data/xdg/cache')
      expect(env['XDG_STATE_HOME']).toBe('/mock/feature.binary.data/xdg/state')
    })

    it('sets MISE_PIPX_UVX so pipx: tools install via the bundled uv, not a missing pipx (#16719)', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const env = await (service as any).buildIsolatedEnv()

      expect(env['MISE_PIPX_UVX']).toBe('1')
    })
  })

  describe('buildIsolatedEnv install settings', () => {
    const buildEnv = async (): Promise<Record<string, string>> => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      return (service as any).buildIsolatedEnv()
    }

    it('maps githubMirror to MISE_URL_REPLACEMENTS with both github.com and api.github.com rules', async () => {
      setInstallSettings({ githubMirror: 'https://ghfast.top/' })
      const env = await buildEnv()

      // Trailing slash trimmed; the API host is rewritten too so `mise latest`
      // version resolution goes through the mirror, not only asset downloads.
      const rules = JSON.parse(env['MISE_URL_REPLACEMENTS'])
      expect(rules['https://github.com']).toBe('https://ghfast.top/https://github.com')
      expect(rules['https://api.github.com']).toBe('https://ghfast.top/https://api.github.com')
    })

    it('leaves MISE_URL_REPLACEMENTS unset when no mirror is configured', async () => {
      const env = await buildEnv()
      expect(env['MISE_URL_REPLACEMENTS']).toBeUndefined()
    })

    it('lets an explicit npm/pip registry override the China auto-mirror', async () => {
      const { regionService } = await import('@main/services/RegionService')
      ;(regionService.isInChina as any).mockResolvedValueOnce(true)
      setInstallSettings({ npmRegistry: 'https://my.npm/', pipIndexUrl: 'https://my.pip/simple' })

      const env = await buildEnv()
      expect(env['NPM_CONFIG_REGISTRY']).toBe('https://my.npm/')
      expect(env['PIP_INDEX_URL']).toBe('https://my.pip/simple')
    })

    it('keeps the China auto-mirror when registries are left empty', async () => {
      const { regionService } = await import('@main/services/RegionService')
      ;(regionService.isInChina as any).mockResolvedValueOnce(true)

      const env = await buildEnv()
      expect(env['NPM_CONFIG_REGISTRY']).toBe('https://registry.npmmirror.com')
      expect(env['PIP_INDEX_URL']).toBe('https://pypi.tuna.tsinghua.edu.cn/simple')
    })

    it('lets a settings token supersede the CHERRY_GITHUB_TOKEN env opt-in', async () => {
      const original = { ...process.env }
      try {
        process.env['CHERRY_GITHUB_TOKEN'] = 'ghp_env'
        setInstallSettings({ githubToken: 'ghp_settings' })
        const env = await buildEnv()
        expect(env['GITHUB_TOKEN']).toBe('ghp_settings')
      } finally {
        process.env = original
      }
    })

    it('falls back to the CHERRY_GITHUB_TOKEN env when the settings token is empty', async () => {
      const original = { ...process.env }
      try {
        process.env['CHERRY_GITHUB_TOKEN'] = 'ghp_env'
        const env = await buildEnv()
        expect(env['GITHUB_TOKEN']).toBe('ghp_env')
      } finally {
        process.env = original
      }
    })

    it('disables the aqua signature checks only when verifySignatures is off', async () => {
      const on = await buildEnv()
      expect(on['MISE_AQUA_COSIGN']).toBeUndefined()
      expect(on['MISE_AQUA_SLSA']).toBeUndefined()
      expect(on['MISE_AQUA_MINISIGN']).toBeUndefined()

      setInstallSettings({ verifySignatures: false })
      const off = await buildEnv()
      expect(off['MISE_AQUA_COSIGN']).toBe('false')
      expect(off['MISE_AQUA_SLSA']).toBe('false')
      expect(off['MISE_AQUA_MINISIGN']).toBe('false')
    })

    it('never leaks install-only vars into the shared execution env (D7)', async () => {
      // Even with every knob set, getBinaryExecutionEnv (which runs the launched
      // CLIs) must stay free of token/registry/mirror/aqua/pipx vars.
      setInstallSettings({
        githubMirror: 'https://ghfast.top',
        npmRegistry: 'https://my.npm',
        pipIndexUrl: 'https://my.pip',
        githubToken: 'ghp_secret',
        verifySignatures: false
      })
      await buildEnv()

      const execEnv = getBinaryExecutionEnv()
      for (const key of [
        'GITHUB_TOKEN',
        'NPM_CONFIG_REGISTRY',
        'PIP_INDEX_URL',
        'MISE_URL_REPLACEMENTS',
        'MISE_PIPX_UVX',
        'MISE_AQUA_COSIGN',
        'MISE_AQUA_SLSA',
        'MISE_AQUA_MINISIGN'
      ]) {
        expect(execEnv[key]).toBeUndefined()
      }
    })
  })

  describe('install-env cache invalidation', () => {
    it('subscribes to install settings + proxy prefs and drops the memoized env on change', () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).onAllReady()

      const [keys, cb] = mockPreferenceService.subscribeMultipleChanges.mock.calls[0] as unknown as [
        string[],
        () => void
      ]
      expect(keys).toEqual(
        expect.arrayContaining([
          'feature.binary.install_settings',
          'app.proxy.mode',
          'app.proxy.url',
          'app.proxy.bypass_rules'
        ])
      )

      ;(service as any).isolatedEnv = { stale: '1' }
      ;(service as any).isolatedEnvPromise = Promise.resolve({})
      cb()
      expect((service as any).isolatedEnv).toBeNull()
      expect((service as any).isolatedEnvPromise).toBeNull()
    })

    it('does not repopulate the cache from a build that resolved after an invalidation', async () => {
      const { regionService } = await import('@main/services/RegionService')
      let release!: () => void
      ;(regionService.isInChina as any).mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          release = () => resolve(false)
        })
      )
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      const inFlight = (service as any).getIsolatedEnv()
      // Invalidate while the build is blocked on the region lookup.
      ;(service as any).isolatedEnv = null
      ;(service as any).isolatedEnvPromise = null
      release()
      await inFlight

      // The stale resolve must not repopulate isolatedEnv (generation guard).
      expect((service as any).isolatedEnv).toBeNull()
    })
  })

  describe('installWithMise', () => {
    it('uses mise global config and reshim for npm: backend tools', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'npm:ntn': [{ version: '1.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/ntn\n', stderr: '' }) // which ntn (ready check)

      const result = await service.installTool({ name: 'ntn', tool: 'npm:ntn', version: '1.0.0' })

      expect(result.version).toBe('1.0.0')
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['use', '-g', 'node@22', 'npm:ntn@1.0.0'], {
        cwd: '/tmp',
        env: {},
        timeout: 120_000
      })
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['reshim'], {
        cwd: '/tmp',
        env: {},
        timeout: 120_000
      })
    })

    it('normalizes a leading-v pin to a bare version when mise ls cannot resolve it', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: 'not json', stderr: '' }) // ls --json -> parse fails, hit fallback

      // semverValid normalizes 'v1.2.3' -> '1.2.3' so the persisted version
      // round-trips against mise's bare resolved version (no reinstall loop).
      const version = await (service as any).installWithMise({
        name: 'fd',
        tool: 'github:sharkdp/fd',
        version: 'v1.2.3'
      })
      expect(version).toBe('1.2.3')
    })
  })

  describe('state mutex concurrency', () => {
    it('serializes concurrent installTool calls', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const callOrder: string[] = []
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') {
          const toolSpec = args[args.length - 1]
          callOrder.push(`use:${toolSpec}:start`)
          await new Promise((r) => setTimeout(r, 10))
          callOrder.push(`use:${toolSpec}:end`)
        }
        if (args[0] === 'ls') {
          const toolKey = args[2]
          return { stdout: JSON.stringify({ [toolKey]: [{ version: '1.0.0' }] }), stderr: '' }
        }
        if (args[0] === 'which') {
          return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const p1 = service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })
      const p2 = service.installTool({ name: 'rg', tool: 'github:BurntSushi/ripgrep', version: '15.0.0' })

      await Promise.all([p1, p2])

      const useStarts = callOrder.filter((e) => e.endsWith(':start'))
      const useEnds = callOrder.filter((e) => e.endsWith(':end'))
      expect(useStarts[0]).toContain('sharkdp/fd')
      expect(useEnds[0]).toContain('sharkdp/fd')
      expect(useStarts[1]).toContain('BurntSushi/ripgrep')
    })
  })

  describe('installTool validation', () => {
    it('rejects invalid tool names before calling installWithMise', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      await expect(service.installTool({ name: '../etc', tool: 'fd' })).rejects.toThrow('Invalid tool name')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('accepts valid tools and calls installWithMise', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })
      expect(result.version).toBe('10.0.0')
    })
  })

  describe('runMise env/cwd contract', () => {
    it('passes isolated env and cwd to execFileAsync, not process.env', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const isolatedEnv = { MISE_DATA_DIR: '/isolated', PATH: '/isolated/shims' }
      ;(service as any).isolatedEnv = isolatedEnv

      mockExecFileAsync.mockResolvedValueOnce({ stdout: 'ok\n', stderr: '' })

      await (service as any).runMise(['which', 'fd'])

      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['which', 'fd'], {
        cwd: '/tmp',
        env: isolatedEnv,
        timeout: 120_000
      })
    })

    it('throws when mise binary is null', async () => {
      const service = new BinaryManager()

      await expect((service as any).runMise(['which', 'fd'])).rejects.toThrow('mise binary not available')
    })

    it('folds mise stderr into the thrown error so the diagnostic is not lost (#16719)', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { MISE_DATA_DIR: '/isolated' }

      // execFileAsync rejects with a generic "Command failed" message; the real
      // reason is on err.stderr. runMise must surface it, not swallow it.
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed: mise use -g pipx:foo'), {
          stderr: 'mise ERROR pipx install failed: program not found'
        })
      )

      await expect((service as any).runMise(['use', '-g', 'pipx:foo'])).rejects.toThrow(
        'mise ERROR pipx install failed: program not found'
      )
    })
  })

  describe('lazy isolated env', () => {
    // buildIsolatedEnv() blocks on a region lookup (regionService.isInChina)
    // whose cache is cold on every launch. It must NOT run at init — only on the
    // first actual mise invocation — so that lookup stays off the Background-phase
    // startup path that gates allReady().
    it('does not build the isolated env (no region lookup) until the first mise run', async () => {
      const { regionService } = await import('@main/services/RegionService')
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      expect((service as any).isolatedEnv).toBeNull()
      expect(regionService.isInChina).not.toHaveBeenCalled()

      mockExecFileAsync.mockResolvedValue({ stdout: 'ok\n', stderr: '' })
      await (service as any).runMise(['which', 'fd'])

      expect(regionService.isInChina).toHaveBeenCalledTimes(1)
      expect((service as any).isolatedEnv).not.toBeNull()
    })

    it('builds the isolated env once across concurrent first mise runs', async () => {
      const { regionService } = await import('@main/services/RegionService')
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockExecFileAsync.mockResolvedValue({ stdout: 'ok\n', stderr: '' })
      await Promise.all([(service as any).runMise(['registry']), (service as any).runMise(['registry'])])

      // Memoized in-flight promise → a single build and a single region lookup.
      expect(regionService.isInChina).toHaveBeenCalledTimes(1)
    })
  })

  describe('extractBundledBinaries', () => {
    let mockFsp: Record<string, ReturnType<typeof vi.fn>>

    beforeEach(async () => {
      const fspModule = await import('node:fs/promises')
      mockFsp = fspModule.default as unknown as Record<string, ReturnType<typeof vi.fn>>
    })

    it('skips extraction when bundled version matches installed version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('.mise-version')) return '2025.1.0'
        return ''
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).not.toHaveBeenCalled()
    })

    it('copies binary when bundled version is newer than installed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('.mise-version')) {
          return p.includes('binaries') ? '2025.2.0' : '2025.1.0'
        }
        return ''
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).toHaveBeenCalled()
    })

    it('copies binary when no installed version exists', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('binaries') && p.includes('.mise-version')) return '2025.1.0'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      mockFs.existsSync.mockImplementation((...args: unknown[]) => {
        const p = args[0]
        if (typeof p === 'string' && p.includes('binaries')) return true
        return false
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).toHaveBeenCalled()
    })
  })

  describe('loadState validation', () => {
    it('discards malformed tool entries from state file', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            valid: {
              tool: 'github:sharkdp/fd',
              version: '10.0.0'
            },
            broken: { tool: undefined, version: '1.0.0' },
            injected: { tool: '../../../etc/passwd', version: '1.0.0' }
          }
        })
      )

      const state = (service as any).loadState()
      expect(state.tools.valid).toBeDefined()
      expect(state.tools.broken).toBeUndefined()
      expect(state.tools.injected).toBeUndefined()
    })

    it('backs up a corrupt state file and resets instead of failing', () => {
      const service = new BinaryManager()
      mockFs.readFileSync.mockReturnValue('{ not valid json')

      const state = (service as any).loadState()

      expect(state).toEqual({ tools: {} })
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/\.corrupt$/), '{ not valid json')
    })

    it('starts empty (no throw) on a non-ENOENT read error', () => {
      const service = new BinaryManager()
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      })

      expect((service as any).loadState()).toEqual({ tools: {} })
    })
  })

  describe('reconcile stateSaveError', () => {
    it('populates stateSaveError when saveState throws', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('disk full')
      })

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.stateSaveError).toContain('disk full')
    })
  })
})
