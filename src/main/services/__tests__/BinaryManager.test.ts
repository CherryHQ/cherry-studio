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
    get: vi.fn(),
    getMultiple: vi.fn(),
    subscribeMultipleChanges: vi.fn(() => () => {})
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

vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: vi.fn(async () => ({ PATH: '/usr/local/bin:/usr/bin' }))
}))

vi.mock('@main/utils/commandResolver', () => ({
  findCommandInShellEnv: vi.fn(async () => null)
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

const { BinaryManager, validateManagedBinary } = await import('../BinaryManager')
const { application: mockApplication } = await import('@application')
const { findCommandInShellEnv } = await import('@main/utils/commandResolver')
const { MockMainCacheServiceUtils } = await import('@test-mocks/main/CacheService')
const { getBinaryExecutionEnv, getBinaryIsolatedHomeEnv } = await import('@main/utils/binaryEnv')

const DEFAULT_INSTALL_PREFERENCES = {
  githubMirror: '',
  githubToken: '',
  npmRegistry: '',
  pipIndexUrl: '',
  verifySignatures: true
}

const mockInstallPreferences = (values = DEFAULT_INSTALL_PREFERENCES) => {
  const preferenceValues = {
    'feature.binary.install.github_mirror': values.githubMirror,
    'feature.binary.install.github_token': values.githubToken,
    'feature.binary.install.npm_registry': values.npmRegistry,
    'feature.binary.install.pip_index_url': values.pipIndexUrl,
    'feature.binary.install.verify_signatures': values.verifySignatures
  }
  mockPreferenceService.get.mockImplementation(
    (key: string) => preferenceValues[key as keyof typeof preferenceValues] ?? []
  )
  mockPreferenceService.getMultiple.mockImplementation((keys: Record<string, string>) =>
    Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, mockPreferenceService.get(key)]))
  )
}

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
    mockInstallPreferences()
  })

  describe('decorators', () => {
    it('is registered as Background phase', () => {
      expect(getPhase(BinaryManager)).toBe(Phase.Background)
    })
  })

  describe('install preference subscriptions', () => {
    it('invalidates the isolated environment for every atomic install preference', () => {
      const service = new BinaryManager()

      ;(service as any).onAllReady()

      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenCalledWith(
        [
          'feature.binary.install.github_mirror',
          'feature.binary.install.github_token',
          'feature.binary.install.npm_registry',
          'feature.binary.install.pip_index_url',
          'feature.binary.install.verify_signatures',
          'app.proxy.mode',
          'app.proxy.url',
          'app.proxy.bypass_rules'
        ],
        expect.any(Function)
      )
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

  describe('listTools', () => {
    it('maps state-file entries to the inventory shape', () => {
      const service = new BinaryManager()

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '10.0.0' },
            mytool: { tool: 'npm:mytool', version: '1.2.3' }
          }
        })
      )

      expect(service.listTools()).toEqual([
        { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' },
        { name: 'mytool', tool: 'npm:mytool', version: '1.2.3' }
      ])
    })

    it('returns an empty inventory when no state file exists', () => {
      const service = new BinaryManager()
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(service.listTools()).toEqual([])
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

    it('persists the requested upgraded version when mise ls returns multiple installed versions', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          tools: {
            fd: { tool: 'github:sharkdp/fd', version: '9.0.0' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '9.0.0' }, { version: '10.0.0' }] }),
          stderr: ''
        }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })

      expect(result.version).toBe('10.0.0')
      const savedState = JSON.parse(mockFs.writeFileSync.mock.calls.at(-1)![1])
      expect(savedState.tools.fd.version).toBe('10.0.0')
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

    it('forces pipx tools through the bundled uv/uvx runtime', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      const env = await (service as any).buildIsolatedEnv()

      expect(env['MISE_PIPX_UVX']).toBe('1')
      expect(getBinaryExecutionEnv()['MISE_PIPX_UVX']).toBeUndefined()
    })

    it('applies configured registries, GitHub mirror/token, and verification override only to the install env', async () => {
      mockInstallPreferences({
        githubMirror: 'https://ghfast.top/',
        githubToken: 'ghp_settings',
        npmRegistry: 'https://registry.example',
        pipIndexUrl: 'https://pypi.example/simple',
        verifySignatures: false
      })
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const env = await (service as any).buildIsolatedEnv()

      expect(mockPreferenceService.getMultiple).toHaveBeenCalledWith({
        githubMirror: 'feature.binary.install.github_mirror',
        githubToken: 'feature.binary.install.github_token',
        npmRegistry: 'feature.binary.install.npm_registry',
        pipIndexUrl: 'feature.binary.install.pip_index_url',
        verifySignatures: 'feature.binary.install.verify_signatures'
      })
      expect(env['NPM_CONFIG_REGISTRY']).toBe('https://registry.example')
      expect(env['PIP_INDEX_URL']).toBe('https://pypi.example/simple')
      expect(env['MISE_PIPX_REGISTRY_URL']).toBe('https://pypi.example/simple/{}/')
      expect(env['GITHUB_TOKEN']).toBe('ghp_settings')
      expect(JSON.parse(env['MISE_URL_REPLACEMENTS'])['https://github.com']).toBe(
        'https://ghfast.top/https://github.com'
      )
      expect(env['MISE_AQUA_COSIGN']).toBe('false')
      expect(env['MISE_AQUA_GITHUB_ATTESTATIONS']).toBe('false')
      expect(getBinaryExecutionEnv()['GITHUB_TOKEN']).toBeUndefined()
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
      // Installs may download a runtime (node/python) — they get the long
      // budget, unlike query commands which keep the 120s default.
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['use', '-g', 'node@22', 'npm:ntn@1.0.0'], {
        cwd: '/tmp',
        env: {},
        timeout: 900_000
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

  describe('install state tracking', () => {
    const mockSuccessfulInstall = (toolKey: string, binaryName: string) => {
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({ [toolKey]: [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${binaryName}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })
    }

    it('broadcasts installing, then clears the entry on success', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockSuccessfulInstall('github:sharkdp/fd', 'fd')
      const broadcast = mockApplication.get('IpcApiService').broadcast as ReturnType<typeof vi.fn>

      const pending = service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '1.0.0' })
      expect(service.getInstallStates()).toEqual({ fd: { status: 'installing' } })
      await pending

      expect(service.getInstallStates()).toEqual({})
      const stateCalls = broadcast.mock.calls.filter(([event]) => event === 'binary.install_states_changed')
      expect(stateCalls[0][1]).toEqual({ fd: { status: 'installing' } })
      expect(stateCalls[stateCalls.length - 1][1]).toEqual({})
    })

    it('keeps a failed entry with the error message until retried', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValue(Object.assign(new Error('mise use timed out after 900s'), {}))

      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd' })).rejects.toThrow('timed out')
      expect(service.getInstallStates()).toEqual({
        fd: { status: 'failed', error: expect.stringContaining('timed out') }
      })

      // A retry replaces failed with installing before the mutex work starts.
      mockSuccessfulInstall('github:sharkdp/fd', 'fd')
      await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '1.0.0' })
      expect(service.getInstallStates()).toEqual({})
    })

    it('does not track state for a spec rejected by validation', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      await expect(service.installTool({ name: '../etc', tool: 'fd' })).rejects.toThrow('Invalid tool name')
      expect(service.getInstallStates()).toEqual({})
    })

    it('removeTool clears a lingering failed entry', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValue(new Error('boom'))
      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd' })).rejects.toThrow('boom')

      mockFs.readFileSync.mockImplementation(() => JSON.stringify({ tools: {} }))
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      await service.removeTool('fd')

      expect(service.getInstallStates()).toEqual({})
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

    it('includes mise stderr in the thrown diagnostic', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed'), { stderr: 'network timeout\n' })
      )

      await expect((service as any).runMise(['use', '-g', 'fd'])).rejects.toThrow('Command failed\nnetwork timeout')
    })

    it('does not append stderr when the command error already includes it', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed\nnetwork timeout'), { stderr: 'network timeout\n' })
      )

      const error = await (service as any).runMise(['use', '-g', 'fd']).catch((caught: Error) => caught)
      expect(error.message).toBe('Command failed\nnetwork timeout')
    })

    it('throws when mise binary is null', async () => {
      const service = new BinaryManager()

      await expect((service as any).runMise(['which', 'fd'])).rejects.toThrow('mise binary not available')
    })

    it('rewrites a timeout kill into a readable message, keeping stderr as detail', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      // execFile timeout kill: killed=true, stderr stuck on a progress line.
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed: /mock/mise use -g node@22 npm:openclaw@latest'), {
          killed: true,
          signal: 'SIGTERM',
          stderr: 'mise npm:openclaw@2026.6.11   [1/3] install\n'
        })
      )

      const error = await (service as any)
        .runMise(['use', '-g', 'node@22', 'npm:openclaw@latest'], { timeoutMs: 0 })
        .catch((caught: Error) => caught)
      expect(error.message).toContain('mise use timed out after 0s')
      expect(error.message).toContain('[1/3] install')
      expect(error.message).not.toContain('Command failed')
    })

    it('does not rewrite a kill that happened before the timeout elapsed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      // killed=true but rejection is immediate (elapsed < timeout): an external
      // kill, not our timeout — the original message must survive.
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed: /mock/mise use -g fd'), { killed: true, signal: 'SIGKILL' })
      )

      const error = await (service as any).runMise(['use', '-g', 'fd']).catch((caught: Error) => caught)
      expect(error.message).toBe('Command failed: /mock/mise use -g fd')
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

  describe('resolveTools', () => {
    it('resolves system tools against the raw login-shell PATH', async () => {
      const { getRawShellEnv } = await import('@main/utils/shellEnv')
      vi.mocked(getRawShellEnv).mockResolvedValueOnce({ PATH: '/usr/local/bin:/usr/bin' })
      vi.mocked(findCommandInShellEnv).mockImplementation(async (name: string) =>
        name === 'gemini' ? '/usr/local/bin/gemini' : null
      )

      await expect(new BinaryManager().resolveTools(['gemini'])).resolves.toEqual({
        gemini: { source: 'system', path: '/usr/local/bin/gemini' }
      })
      expect(findCommandInShellEnv).toHaveBeenCalledWith('gemini', {
        PATH: '/usr/local/bin:/usr/bin'
      })
    })

    it('returns none for a Cherry-owned result found by the system probe', async () => {
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/mock/cherry.bin/uv')

      await expect(new BinaryManager().resolveTools(['uv'])).resolves.toEqual({ uv: { source: 'none' } })
    })

    it('prefers a bundled binary over the system PATH', async () => {
      mockFs.existsSync.mockImplementation((...args: unknown[]) => args[0] === '/mock/cherry.bin/uv')
      mockFs.readFileSync.mockImplementation((candidate: unknown) => {
        if (candidate === '/mock/feature.binary.state_file') return JSON.stringify({ tools: {} })
        if (candidate === '/mock/cherry.bin/.uv-version') return '1.0.0'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/uv')

      await expect(new BinaryManager().resolveTools(['uv'])).resolves.toEqual({
        uv: { source: 'bundled', path: '/mock/cherry.bin/uv', version: '1.0.0' }
      })
      expect(findCommandInShellEnv).not.toHaveBeenCalledWith('uv', expect.anything())
    })

    it('resolves secondary bundled executables such as uvx', async () => {
      mockFs.existsSync.mockImplementation((...args: unknown[]) => args[0] === '/mock/cherry.bin/uvx')
      mockFs.readFileSync.mockImplementation((candidate: unknown) => {
        if (candidate === '/mock/feature.binary.state_file') return JSON.stringify({ tools: {} })
        if (candidate === '/mock/cherry.bin/.uv-version') return '1.0.0'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      await expect(new BinaryManager().resolveTools(['uvx'])).resolves.toEqual({
        uvx: { source: 'bundled', path: '/mock/cherry.bin/uvx', version: '1.0.0' }
      })
    })

    it('prefers a valid managed binary over the system PATH', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ tools: { gemini: { tool: 'npm:@google/gemini-cli', version: '1.2.3' } } })
      )
      mockExecFileAsync.mockResolvedValue({ stdout: '/mock/managed/gemini\n', stderr: '' })
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      await expect(service.resolveTools(['gemini'])).resolves.toEqual({
        gemini: { source: 'managed', path: '/mock/managed/gemini', version: '1.2.3' }
      })
      expect(findCommandInShellEnv).not.toHaveBeenCalledWith('gemini', expect.anything())
    })

    it('falls back to the system PATH when persisted managed state is stale', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ tools: { gemini: { tool: 'npm:@google/gemini-cli', version: '1.2.3' } } })
      )
      mockExecFileAsync.mockRejectedValue(new Error('not installed'))
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/gemini')
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      await expect(service.resolveTools(['gemini'])).resolves.toEqual({
        gemini: { source: 'system', path: '/usr/local/bin/gemini' }
      })
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
