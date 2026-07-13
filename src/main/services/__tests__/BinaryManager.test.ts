import type * as LifecycleModule from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manifestRef, mockExecFileAsync, mockFs, mockFsp, mockPreferenceService, platformMock } = vi.hoisted(() => ({
  manifestRef: { value: [] as Array<{ name: string; tool: string; requestedVersion?: string }> },
  platformMock: { isWin: false },
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
  mockFsp: {
    mkdir: vi.fn(async () => {}),
    copyFile: vi.fn(async () => {}),
    chmod: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    access: vi.fn(async () => {})
  },
  mockPreferenceService: {
    get: vi.fn(),
    getMultiple: vi.fn(),
    set: vi.fn(),
    subscribeMultipleChanges: vi.fn(() => () => {})
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: mockPreferenceService
  })
})

vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platformMock.isWin
  }
}))

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

vi.mock('node:fs/promises', () => ({ default: mockFsp }))

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
  findCommandInShellEnv: vi.fn(async () => null),
  findExecutable: vi.fn(() => null)
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

const { BinaryManager, validateBinaryManifestEntry } = await import('../BinaryManager')
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
  mockPreferenceService.get.mockImplementation((key: string) =>
    key === 'feature.binary.tools' ? manifestRef.value : (preferenceValues[key as keyof typeof preferenceValues] ?? [])
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
    platformMock.isWin = false
    mockFs.existsSync.mockReset().mockReturnValue(false)
    mockFs.readFileSync.mockReset()
    mockFsp.access.mockReset().mockResolvedValue(undefined)
    manifestRef.value = []
    mockInstallPreferences()
    mockPreferenceService.set.mockImplementation(async (key: string, value: typeof manifestRef.value) => {
      if (key === 'feature.binary.tools') manifestRef.value = value
    })
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

  describe('getToolSnapshots', () => {
    it('returns the requested, owned, auto-runtime, and operation names from one manifest and mise refresh', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [{ name: 'fd', tool: 'fd', requestedVersion: '10.0.0' }]
      MockMainCacheServiceUtils.setSharedCacheValue('feature.binary.install_states', {
        later: {
          status: 'failed',
          action: 'install',
          error: 'offline',
          intent: { name: 'later', tool: 'npm:later' }
        }
      })
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) =>
        ['/mock/feature.binary.data/shims/fd', '/mock/feature.binary.data/shims/node', '/mock/cherry.bin/bun'].includes(
          candidate
        )
      )
      mockFs.readFileSync.mockImplementation((candidate: string) =>
        candidate === '/mock/cherry.bin/.bun-version'
          ? '1.2.3'
          : (() => {
              throw new Error('ENOENT')
            })()
      )
      vi.mocked(findCommandInShellEnv).mockImplementation(async (name: string) =>
        name === 'missing' ? '/usr/local/bin/missing' : null
      )
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          fd: [{ version: '10.0.0', active: true }],
          node: [{ version: '22.0.0', active: true }]
        }),
        stderr: ''
      })

      await expect(service.getToolSnapshots(['bun', 'missing'])).resolves.toEqual({
        bun: { name: 'bun', availability: { source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' } },
        missing: { name: 'missing', availability: { source: 'system', path: '/usr/local/bin/missing' } },
        fd: {
          name: 'fd',
          intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' },
          availability: { source: 'mise', tool: 'fd', path: '/mock/feature.binary.data/shims/fd', version: '10.0.0' }
        },
        node: {
          name: 'node',
          availability: {
            source: 'mise',
            tool: 'node',
            path: '/mock/feature.binary.data/shims/node',
            version: '22.0.0'
          }
        },
        later: {
          name: 'later',
          availability: { source: 'none' },
          operation: {
            status: 'failed',
            action: 'install',
            error: 'offline',
            intent: { name: 'later', tool: 'npm:later' }
          }
        }
      })
      expect(mockPreferenceService.get).toHaveBeenCalledTimes(1)
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1)
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['ls', '--json'], expect.any(Object))
    })

    it('reports a requested unowned preset when batched mise ls and its shim agree', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
        stderr: ''
      })

      const snapshots = await service.getToolSnapshots(['fd'])

      expect(snapshots.fd).toEqual({
        name: 'fd',
        availability: { source: 'mise', tool: 'fd', path: '/mock/feature.binary.data/shims/fd', version: '10.0.0' }
      })
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1)
      expect(mockFsp.access).toHaveBeenCalledWith('/mock/feature.binary.data/shims/fd', mockFs.constants.X_OK)
    })

    it('falls back when a matching mise shim is not executable', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
        stderr: ''
      })
      mockFsp.access.mockRejectedValue(new Error('EACCES'))
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

      await expect(service.getToolSnapshots(['fd'])).resolves.toMatchObject({
        fd: { availability: { source: 'system', path: '/usr/local/bin/fd' } }
      })
    })

    it('falls back from an owned missing mise shim to bundled, system, and none availability', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [
        { name: 'bun', tool: 'bun' },
        { name: 'fd', tool: 'fd' },
        { name: 'gone', tool: 'gone' }
      ]
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === '/mock/cherry.bin/bun')
      mockFs.readFileSync.mockImplementation((candidate: string) =>
        candidate === '/mock/cherry.bin/.bun-version'
          ? '1.2.3'
          : (() => {
              throw new Error('ENOENT')
            })()
      )
      vi.mocked(findCommandInShellEnv).mockImplementation(async (name: string) =>
        name === 'fd' ? '/usr/local/bin/fd' : null
      )
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          bun: [{ version: '2.0.0' }],
          fd: [{ version: '10.0.0' }],
          gone: [{ version: '1.0.0' }]
        }),
        stderr: ''
      })
      mockFsp.access.mockRejectedValue(new Error('ENOENT'))

      const snapshots = await service.getToolSnapshots([])
      expect(snapshots.bun?.availability).toEqual({ source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' })
      expect(snapshots.fd?.availability).toEqual({ source: 'system', path: '/usr/local/bin/fd' })
      expect(snapshots.gone?.availability).toEqual({ source: 'none' })
    })

    it('publishes installing before a blocked mutation and lets snapshots read it without waiting', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      const release = await (service as any).mutationMutex.acquire()

      const pending = service.installTool({ intent: { name: 'fd', tool: 'fd' } })
      await expect(service.getToolSnapshots([])).resolves.toMatchObject({
        fd: { operation: { status: 'installing' } }
      })
      release()
      await expect(pending).rejects.toThrow('mise did not report an installed version')
    })
  })

  describe('manifest transitions', () => {
    it('does not install managed tools during startup', async () => {
      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      const service = new BinaryManager()
      ;(service as any).onAllReady()

      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('leaves an installed binary unowned when the manifest write fails', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockPreferenceService.set.mockRejectedValueOnce(new Error('preference write failed'))
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({ fd: [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).rejects.toThrow(
        'preference write failed'
      )
      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual(['use', '-g', 'fd@latest'])
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [{ name: 'fd', tool: 'fd' }])
      expect(manifestRef.value).toEqual([])
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: {
          status: 'failed',
          action: 'install',
          error: 'preference write failed',
          intent: { name: 'fd', tool: 'fd' }
        }
      })
    })
  })

  describe('manifest mutation safety', () => {
    it('serializes concurrent manifest writes without dropping either intent', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      let manifest: Array<{ name: string; tool: string; requestedVersion?: string }> = []
      mockPreferenceService.get.mockImplementation((key: string) => (key === 'feature.binary.tools' ? manifest : []))
      mockPreferenceService.set.mockImplementation(async (key: string, value: typeof manifest) => {
        if (key === 'feature.binary.tools') manifest = value
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ [args[2] ?? 'fd']: [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await Promise.all([
        service.installTool({ intent: { name: 'fd', tool: 'fd' } }),
        service.installTool({ intent: { name: 'rg', tool: 'rg' } })
      ])

      expect(manifest).toEqual([
        { name: 'fd', tool: 'fd' },
        { name: 'rg', tool: 'rg' }
      ])
    })

    it('claims an existing runtime with its live version as a durable pin', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        if (args[0] === 'ls') return { stdout: JSON.stringify({ node: [{ version: '22.23.1' }] }), stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installTool({ intent: { name: 'node', tool: 'core:node' } })

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [
        { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }
      ])
    })

    it('updates a ready runtime when a different one-shot target is requested', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [{ name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }]
      let lsCalls = 0
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        if (args[0] === 'ls') {
          lsCalls += 1
          const version = lsCalls === 1 ? '22.23.1' : '23.1.0'
          return { stdout: JSON.stringify({ node: [{ version, active: true }] }), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      await service.installTool({
        intent: { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' },
        targetVersion: '23.1.0'
      })

      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual([
        'use',
        '-g',
        'core:node@23.1.0'
      ])
      expect(manifestRef.value).toEqual([{ name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }])
    })

    it('pins the resolved version after installing a new runtime', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      let whichCalls = 0
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'which') {
          whichCalls += 1
          return { stdout: whichCalls === 1 ? '' : '/mock/mise/shims/node\n', stderr: '' }
        }
        if (args[0] === 'ls') return { stdout: JSON.stringify({ node: [{ version: '22.23.1' }] }), stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installTool({ intent: { name: 'node', tool: 'core:node' } })

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [
        { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }
      ])
    })
  })

  describe('removeTool', () => {
    const setManifest = (tools: Record<string, { tool: string; version?: string }>) => {
      manifestRef.value = Object.entries(tools).map(([name, entry]) => ({
        name,
        tool: entry.tool,
        ...(entry.version ? { requestedVersion: entry.version } : {})
      }))
    }

    it('does not uninstall a tool without manifest ownership', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      await service.removeTool('fd')

      expect(mockExecFileAsync).not.toHaveBeenCalled()
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('uninstalls a managed runtime and clears its manifest intent after confirming absence', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ node: { tool: 'core:node', version: '22.23.1' } })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return {
            stdout:
              args.length === 3 && mockExecFileAsync.mock.calls.filter((c) => c[1][0] === 'ls').length > 1
                ? '{}'
                : JSON.stringify({ node: [{ version: '22.23.1' }] }),
            stderr: ''
          }
        return { stdout: '', stderr: '' }
      })

      await service.removeTool('node')

      const miseArgs = mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
      expect(miseArgs).toContainEqual(['unuse', '-g', 'core:node'])
      expect(miseArgs).toContainEqual(['uninstall', '--all', 'core:node'])
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
    })

    it('retains intent when mise removal fails', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ node: { tool: 'core:node', version: '22.23.1' } })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({ node: [{ version: '22.23.1' }] }), stderr: '' }
        throw new Error('mise removal failed')
      })

      await expect(service.removeTool('node')).rejects.toThrow('mise removal failed')
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('retries reshim before clearing intent after a prior uninstall succeeded', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ fd: { tool: 'fd' } })
      let installed = true
      let reshimCalls = 0
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return { stdout: installed ? JSON.stringify({ fd: [{ version: '1.0.0' }] }) : '{}', stderr: '' }
        }
        if (args[0] === 'uninstall') installed = false
        if (args[0] === 'reshim') {
          reshimCalls += 1
          if (reshimCalls === 1) throw new Error('reshim failed')
        }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool('fd')).rejects.toThrow('reshim failed')
      expect(manifestRef.value).toEqual([{ name: 'fd', tool: 'fd' }])

      await expect(service.removeTool('fd')).resolves.toBeUndefined()
      expect(reshimCalls).toBe(2)
      expect(manifestRef.value).toEqual([])
    })

    it('cleans up intent when a successful mise ls probe confirms the tool is absent', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ fd: { tool: 'fd' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })

      await service.removeTool('fd')

      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['ls', '--json', 'fd'], expect.any(Object))
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
    })

    it('propagates an absence-probe failure and retains intent', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ fd: { tool: 'fd' } })
      mockExecFileAsync.mockRejectedValue(new Error('mise ls failed'))

      await expect(service.removeTool('fd')).rejects.toThrow('mise ls failed')
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('retains owned-but-missing intent when manifest cleanup fails', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      setManifest({ fd: { tool: 'fd' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      mockPreferenceService.set.mockRejectedValueOnce(new Error('preference write failed'))

      await expect(service.removeTool('fd')).rejects.toThrow('preference write failed')
      expect(manifestRef.value).toEqual([{ name: 'fd', tool: 'fd' }])
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'failed', action: 'remove', error: 'preference write failed' }
      })
    })
  })

  describe('installTool', () => {
    it('throws when mise binary is not available', async () => {
      const service = new BinaryManager()

      await expect(
        service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' } })
      ).rejects.toThrow('Binary backend not available')
    })

    it('rejects a same-name request with a different durable specification', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [{ name: 'mytool', tool: 'npm:original' }]

      await expect(service.installTool({ intent: { name: 'mytool', tool: 'npm:replacement' } })).rejects.toThrow(
        'already owned with a different specification'
      )
      expect(mockExecFileAsync).not.toHaveBeenCalled()
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
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
        .mockResolvedValueOnce({ stdout: JSON.stringify({ fd: [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' } })

      expect(result.version).toBe('10.0.0')
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockFs.chmodSync).not.toHaveBeenCalled()
    })

    it('uses a one-shot update target without pinning a floating manifest intent', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      manifestRef.value = [{ name: 'fd', tool: 'fd' }]

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ fd: [{ version: '9.0.0' }, { version: '10.0.0' }] }),
          stderr: ''
        }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ intent: { name: 'fd', tool: 'fd' }, targetVersion: '10.0.0' })

      expect(result.version).toBe('10.0.0')
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [{ name: 'fd', tool: 'fd' }])
    })

    it('throws and does not persist intent when the binary is not runnable after install', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ fd: [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // which fd -> empty -> not runnable

      await expect(
        service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' } })
      ).rejects.toThrow('not runnable')
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
          { short: 'fd', backends: ['fd'] },
          { short: 'rg', backends: ['rg'] }
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
      manifestRef.value = Object.entries(tools).map(([name, entry]) => ({
        name,
        tool: entry.tool,
        requestedVersion: entry.version
      }))
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
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })

      const result = await service.getLatestVersions()

      expect(result).toEqual({ fd: '10.1.0' })
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map on cache miss when force is false without running mise', async () => {
      const service = setupManaged({
        fd: { tool: 'fd', version: '10.0.0' }
      })

      const result = await service.getLatestVersions()

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map when no tools are managed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('queries the latest version for every managed tool via mise latest', async () => {
      const service = setupManaged({
        fd: { tool: 'fd', version: '10.0.0' },
        rg: { tool: 'rg', version: '15.0.0' }
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'latest') return { stdout: `${args[1] === 'fd' ? '10.1.0' : '15.1.0'}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ fd: '10.1.0', rg: '15.1.0' })
      expect(latestCalls()).toContainEqual(['latest', 'fd'])
      expect(latestCalls()).toContainEqual(['latest', 'rg'])
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0',
        rg: '15.1.0'
      })
    })

    it('omits tools whose latest-version lookup fails', async () => {
      const service = setupManaged({
        fd: { tool: 'fd', version: '10.0.0' },
        rg: { tool: 'rg', version: '15.0.0' }
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] !== 'latest') return { stdout: '', stderr: '' }
        if (args[1] === 'rg') throw new Error('rate limited')
        return { stdout: '10.1.0\n', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      // Failed lookup is omitted, not reported as an error.
      expect(result).toEqual({ fd: '10.1.0' })
    })

    it('stores the result in shared cache so the second non-force call reads it without re-running mise latest', async () => {
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })
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
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })

      const callsBefore = latestCalls().length
      await service.getLatestVersions(true)
      expect(latestCalls().length).toBeGreaterThan(callsBefore)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })
    })

    it('clears the shared cache on manifest mutation so the next non-force call is empty', async () => {
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })

      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })

      await (service as any).upsertManifest({ name: 'fd', tool: 'fd' })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toBeUndefined()

      const callsAfterFirst = latestCalls().length
      const cached = await service.getLatestVersions()
      expect(cached).toEqual({})
      expect(latestCalls().length).toBe(callsAfterFirst)
    })

    it('deduplicates concurrent forced latest-version checks', async () => {
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })
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
      const service = setupManaged({ fd: { tool: 'fd', version: '10.0.0' } })
      mockExecFileAsync.mockResolvedValue({ stdout: '10.1.0\n', stderr: '' })
      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0'
      })

      const setSharedAfterFirst = MockMainCacheServiceUtils.getMockCallCounts().setShared

      mockExecFileAsync.mockImplementationOnce(async () => {
        manifestRef.value = [
          { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' },
          { name: 'rg', tool: 'rg', requestedVersion: '15.0.0' }
        ]
        return { stdout: '10.1.0\n', stderr: '' }
      })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(setSharedAfterFirst)
    })
  })

  describe('validateBinaryManifestEntry', () => {
    it.each([
      ['../etc', 'fd', undefined],
      ['', 'fd', undefined],
      ['fd; rm -rf /', 'fd', undefined],
      ['fd\x00', 'fd', undefined],
      ['123fd', 'fd', undefined]
    ])('rejects invalid tool name=%j', (name, tool, version) => {
      expect(() => validateBinaryManifestEntry({ name, tool, requestedVersion: version })).toThrow('Invalid tool name')
    })

    it.each([
      ['fd', '', undefined],
      ['fd', 'tool; echo', undefined],
      ['fd', 'tool name', undefined],
      ['fd', '../../../etc/passwd', undefined],
      ['fd', 'github://evil', undefined],
      ['fd', '--verbose', undefined]
    ])('rejects invalid tool key=%j tool=%j', (name, tool, version) => {
      expect(() => validateBinaryManifestEntry({ name, tool, requestedVersion: version })).toThrow('Invalid tool key')
    })

    it.each([
      ['fd', 'fd', 'version; echo'],
      ['fd', 'fd', 'ver sion'],
      ['fd', 'fd', '-rf']
    ])('rejects invalid version=%j', (name, tool, version) => {
      expect(() => validateBinaryManifestEntry({ name, tool, requestedVersion: version })).toThrow(
        'Invalid tool version'
      )
    })

    it('accepts valid tool definitions', () => {
      expect(() => validateBinaryManifestEntry({ name: 'fd', tool: 'fd', requestedVersion: '10.0.0' })).not.toThrow()
      expect(() => validateBinaryManifestEntry({ name: 'ntn', tool: 'npm:ntn' })).not.toThrow()
    })

    it.each([
      [{ name: 'uv', tool: 'github:attacker/uv' }, 'canonical specification'],
      [{ name: 'codex', tool: 'npm:attacker-codex' }, 'canonical specification'],
      [{ name: 'node', tool: 'npm:attacker-node' }, 'canonical runtime specification'],
      [{ name: 'node-alt', tool: 'core:node' }, 'canonical runtime specification']
    ])('rejects reserved or aliased identities: %j', async (intent, message) => {
      await expect(new BinaryManager().installTool({ intent })).rejects.toThrow(message)
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

      const result = await service.installTool({ intent: { name: 'ntn', tool: 'npm:ntn', requestedVersion: '1.0.0' } })

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

    it('preserves an explicitly managed runtime when installing a package-backend tool', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [{ name: 'node', tool: 'core:node', requestedVersion: '20.19.4' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'npm:ntn': [{ version: '1.0.0' }] }), stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/ntn\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installTool({ intent: { name: 'ntn', tool: 'npm:ntn', requestedVersion: '1.0.0' } })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        '/mock/mise',
        ['use', '-g', 'core:node@20.19.4', 'npm:ntn@1.0.0'],
        expect.objectContaining({ timeout: 900_000 })
      )
    })

    it('pins an unpinned owned runtime to its live version for a package install', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      manifestRef.value = [{ name: 'node', tool: 'core:node' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args[2] === 'core:node') {
          return { stdout: JSON.stringify({ node: [{ version: '20.19.4', active: true }] }), stderr: '' }
        }
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'npm:ntn': [{ version: '1.0.0', active: true }] }), stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/ntn\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installTool({ intent: { name: 'ntn', tool: 'npm:ntn', requestedVersion: '1.0.0' } })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        '/mock/mise',
        ['use', '-g', 'core:node@20.19.4', 'npm:ntn@1.0.0'],
        expect.objectContaining({ timeout: 900_000 })
      )
    })

    it('normalizes a leading-v pin from verified mise output', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ fd: [{ version: '1.2.3', active: true }] }), stderr: '' })

      // semverValid normalizes 'v1.2.3' -> '1.2.3' before matching mise's output.
      const version = await (service as any).installWithMise(
        { name: 'fd', tool: 'fd', requestedVersion: 'v1.2.3' },
        undefined,
        []
      )
      expect(version).toBe('1.2.3')
    })

    it('rejects malformed mise output instead of fabricating install success', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'not json', stderr: '' })

      await expect(
        (service as any).installWithMise({ name: 'fd', tool: 'fd', requestedVersion: '1.2.3' }, undefined, [])
      ).rejects.toThrow()
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
          const version = toolKey === 'fd' ? '10.0.0' : '15.0.0'
          return { stdout: JSON.stringify({ [toolKey]: [{ version }] }), stderr: '' }
        }
        if (args[0] === 'which') {
          return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const p1 = service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' } })
      const p2 = service.installTool({ intent: { name: 'rg', tool: 'rg', requestedVersion: '15.0.0' } })

      await Promise.all([p1, p2])

      const useStarts = callOrder.filter((e) => e.endsWith(':start'))
      const useEnds = callOrder.filter((e) => e.endsWith(':end'))
      expect(useStarts[0]).toContain('fd')
      expect(useEnds[0]).toContain('fd')
      expect(useStarts[1]).toContain('rg')
    })

    it('coalesces identical same-name installs without replacing their live state', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      let releaseInstall!: () => void
      const installStarted = new Promise<void>((resolve) => {
        releaseInstall = resolve
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') await installStarted
        if (args[0] === 'ls') return { stdout: JSON.stringify({ fd: [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const first = service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '1.0.0' } })
      const second = service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '1.0.0' } })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      releaseInstall()

      await expect(Promise.all([first, second])).resolves.toEqual([{ version: '1.0.0' }, { version: '1.0.0' }])
      expect(mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')).toHaveLength(1)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('rejects a remove while the same tool install is queued without replacing its operation', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      const release = await (service as any).mutationMutex.acquire()
      const install = service.installTool({ intent: { name: 'fd', tool: 'fd' } })

      await expect(service.removeTool('fd')).rejects.toThrow('already installing')
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })

      release()
      await expect(install).rejects.toThrow()
    })

    it('rejects an install while the same tool removal is queued without replacing its operation', async () => {
      const service = new BinaryManager()
      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      const release = await (service as any).mutationMutex.acquire()
      const removal = service.removeTool('fd')

      await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).rejects.toThrow('already removing')
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'removing' }
      })

      release()
      await expect(removal).rejects.toThrow('Binary backend not available')
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'failed', action: 'remove', error: 'Binary backend not available' }
      })
    })

    it('rejects conflicting same-name installs without changing the in-flight state', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      let releaseInstall!: () => void
      const installStarted = new Promise<void>((resolve) => {
        releaseInstall = resolve
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') await installStarted
        if (args[0] === 'ls') return { stdout: JSON.stringify({ fd: [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const first = service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '1.0.0' } })
      await expect(
        service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '2.0.0' } })
      ).rejects.toThrow('already installing with a different specification')
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      releaseInstall()
      await expect(first).resolves.toEqual({ version: '1.0.0' })
    })
  })

  describe('installTool validation', () => {
    it('rejects invalid tool names before calling installWithMise', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      await expect(service.installTool({ intent: { name: '../etc', tool: 'fd' } })).rejects.toThrow('Invalid tool name')
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
        .mockResolvedValueOnce({ stdout: JSON.stringify({ fd: [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd (ready check)

      const result = await service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '10.0.0' } })
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

    it('publishes installing to the shared cache, then clears the entry on success', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockSuccessfulInstall('fd', 'fd')

      const pending = service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '1.0.0' } })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      await pending

      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('keeps a failed entry with the error message until retried', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValue(Object.assign(new Error('mise use timed out after 900s'), {}))

      await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).rejects.toThrow('timed out')
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: {
          status: 'failed',
          action: 'install',
          error: expect.stringContaining('timed out'),
          intent: { name: 'fd', tool: 'fd' }
        }
      })

      // A retry replaces failed with installing before the mutex work starts.
      mockSuccessfulInstall('fd', 'fd')
      await service.installTool({ intent: { name: 'fd', tool: 'fd', requestedVersion: '1.0.0' } })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('publishes a failed entry when the mise backend is unavailable', async () => {
      const service = new BinaryManager()

      await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).rejects.toThrow(
        'Binary backend not available'
      )
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({
        fd: {
          status: 'failed',
          action: 'install',
          error: 'Binary backend not available',
          intent: { name: 'fd', tool: 'fd' }
        }
      })
    })

    it('does not track state for a spec rejected by validation', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      await expect(service.installTool({ intent: { name: '../etc', tool: 'fd' } })).rejects.toThrow('Invalid tool name')
      // Validation rejects before any state is published — the cache key is never written.
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toBeUndefined()
    })

    it('removeTool clears a lingering failed entry', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockRejectedValue(new Error('boom'))
      await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).rejects.toThrow('boom')

      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      await service.removeTool('fd')

      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.install_states')).toEqual({})
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
})
