import type * as NodeModule from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LifecycleModule from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'

const mockCreateRequire = vi.hoisted(() => vi.fn())
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
    readdir: vi.fn(async () => []),
    access: vi.fn(async () => {}),
    realpath: vi.fn(async (candidate: string) => candidate)
  },
  mockPreferenceService: {
    get: vi.fn(),
    getMultiple: vi.fn(),
    set: vi.fn(),
    subscribeMultipleChanges: vi.fn(() => () => {})
  }
}))

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeModule>()
  return { ...actual, createRequire: mockCreateRequire }
})

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
  getRawShellEnv: vi.fn(async () => ({ PATH: '/usr/local/bin:/usr/bin' })),
  refreshShellEnv: vi.fn(async () => ({ PATH: '/usr/local/bin:/usr/bin' }))
}))

vi.mock('@main/utils/commandResolver', () => ({
  findCommandInShellEnv: vi.fn(async () => null),
  findExecutable: vi.fn(() => null),
  findMiseExecutable: vi.fn(async () => null)
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

const { BinaryManager, validateBinaryToolDefinition } = await import('../BinaryManager')
const { application } = await import('@application')
const { findCommandInShellEnv, findExecutable, findMiseExecutable } = await import('@main/utils/commandResolver')
const { regionService } = await import('@main/services/RegionService')
const { getRawShellEnv, refreshShellEnv } = await import('@main/utils/shellEnv')
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
  mockPreferenceService.get.mockImplementation((key: string) => {
    if (key === 'feature.binary.tools') return manifestRef.value
    if (key === 'feature.binary.install_settings') return values
    return []
  })
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
    mockCreateRequire.mockReset().mockReturnValue({ resolve: vi.fn(() => '/mock/resolved-package') })
    platformMock.isWin = false
    mockFs.existsSync.mockReset().mockReturnValue(false)
    mockFs.readFileSync.mockReset()
    mockFsp.readdir.mockReset().mockResolvedValue([])
    mockFsp.access.mockReset().mockResolvedValue(undefined)
    mockFsp.realpath.mockReset().mockImplementation(async (candidate: string) => candidate)
    vi.mocked(findCommandInShellEnv).mockReset().mockResolvedValue(null)
    vi.mocked(findExecutable).mockReset().mockReturnValue(null)
    vi.mocked(findMiseExecutable).mockReset().mockResolvedValue(null)
    vi.mocked(regionService.isInChina).mockReset().mockResolvedValue(false)
    vi.mocked(getRawShellEnv).mockReset().mockResolvedValue({ PATH: '/usr/local/bin:/usr/bin' })
    vi.mocked(refreshShellEnv).mockReset().mockResolvedValue({ PATH: '/usr/local/bin:/usr/bin' })
    manifestRef.value = []
    mockInstallPreferences()
    mockPreferenceService.set.mockImplementation(async (key: string, value: typeof manifestRef.value) => {
      if (key === 'feature.binary.tools') manifestRef.value = value
    })
  })

  const runAllReadyTasks = async (service: InstanceType<typeof BinaryManager>) => {
    expect((service as any).onAllReady()).toBeUndefined()
    // onAllReady owns deferred business work rather than returning its Promise.
    // This later zero-delay timer runs after BinaryManager's scheduled callback.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await (service as any).normalizationPromise
  }

  describe('decorators', () => {
    it('is registered as Background phase', () => {
      expect(getPhase(BinaryManager)).toBe(Phase.Background)
    })
  })

  it('uses the bounded asynchronous Windows resolver to find a system mise executable', async () => {
    platformMock.isWin = true
    const misePath = 'D:\\开发工具\\mise\\mise.exe'
    vi.mocked(findMiseExecutable).mockResolvedValue(misePath)

    const service = new BinaryManager()

    await expect((service as any).findMiseBin()).resolves.toBe(misePath)
    expect(findMiseExecutable).toHaveBeenCalledOnce()
    expect(findExecutable).not.toHaveBeenCalled()
  })

  it('starts the process-wide shell environment capture without awaiting it', async () => {
    vi.mocked(getRawShellEnv).mockReturnValue(new Promise<never>(() => {}))
    const service = new BinaryManager()

    await expect((service as any).onInit()).resolves.toBeUndefined()

    expect(getRawShellEnv).toHaveBeenCalledOnce()
  })

  describe('install preference subscriptions', () => {
    const EXPECTED_KEYS = [
      'feature.binary.install_settings',
      'app.proxy.mode',
      'app.proxy.url',
      'app.proxy.bypass_rules'
    ]

    it('registers install-setting invalidation at system-wide readiness', async () => {
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenCalledWith(EXPECTED_KEYS, expect.any(Function))
    })

    // Timing safety: BinaryManager is Phase.Background, which is fire-and-forget and
    // races BeforeReady (PreferenceService) — so an initial-bootstrap onInit MUST NOT
    // reach PreferenceService. Prove it: on the first onInit (before onAllReady) the
    // service never resolves PreferenceService and registers no subscription; the
    // first registration only happens once onAllReady fires (all phases ready).
    it('does not touch PreferenceService during the initial-bootstrap onInit', async () => {
      const service = new BinaryManager()
      ;(application.get as unknown as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockClear()

      await (service as any).onInit()

      expect(application.get).not.toHaveBeenCalledWith('PreferenceService')
      expect(mockPreferenceService.subscribeMultipleChanges).not.toHaveBeenCalled()

      // System-wide readiness → safe first registration.
      await runAllReadyTasks(service)
      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenCalledTimes(1)
    })

    // Restart safety: onAllReady fires at most once per instance and does not re-run
    // on restart, while registerDisposable subscriptions are torn down on stop — so a
    // stop/restart would otherwise silently lose the invalidation. After the instance
    // has reached onAllReady, a subsequent onInit (the restart path) re-establishes it.
    it('re-establishes the subscription on restart after onAllReady has fired', async () => {
      const service = new BinaryManager()

      // Initial bootstrap: onInit (no subscription yet) then onAllReady (first registration).
      await (service as any).onInit()
      await runAllReadyTasks(service)
      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenCalledTimes(1)

      // Framework stop(): dispose every tracked disposable, then reset the array.
      const disposables = (service as any)._disposables as Array<{ dispose: () => void } | (() => void)>
      for (const disposable of disposables) {
        typeof disposable === 'function' ? disposable() : disposable.dispose()
      }
      disposables.length = 0

      // Restart re-runs onInit (but not onAllReady) — the subscription must return.
      await (service as any).onInit()
      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenCalledTimes(2)
      expect(mockPreferenceService.subscribeMultipleChanges).toHaveBeenLastCalledWith(
        EXPECTED_KEYS,
        expect.any(Function)
      )
      expect(disposables).toHaveLength(1)
    })
  })

  describe('normalizeCustomDefinitions (Preference hygiene on allReady)', () => {
    // The persisted custom registry is untrusted runtime input; onAllReady runs a
    // one-time schema hygiene pass over it before any custom tool is consumed.
    const setRegistry = (raw: unknown) => {
      mockPreferenceService.get.mockImplementation((key: string) => (key === 'feature.binary.tools' ? raw : []))
    }

    it('converts a legacy string version to requestedVersion and rewrites', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.2.3' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [
        { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.2.3' }
      ])
    })

    it('drops an entry whose name is a fixed catalog tool', async () => {
      setRegistry([{ name: 'gh', tool: 'gh' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
    })

    it('drops a custom entry whose normalized spec aliases a fixed catalog tool', async () => {
      setRegistry([{ name: 'myuv', tool: 'core:uv' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
    })

    it('drops a custom Hermes recipe that aliases the Dashboard-enabled fixed recipe', async () => {
      setRegistry([{ name: 'my-hermes', tool: 'pipx:hermes-agent' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
    })

    it('drops malformed entries and rebuilds an entry with extra fields to the canonical shape', async () => {
      setRegistry([
        { name: 'bad name', tool: 'npm:x' },
        { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0', foo: 'bar', extra: 42 }
      ])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [
        { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }
      ])
    })

    it('dedupes duplicate names and specs, keeping the first valid entry', async () => {
      setRegistry([
        { name: 'a', tool: 'foo' },
        { name: 'a', tool: 'other' },
        { name: 'b', tool: 'core:foo' }
      ])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [{ name: 'a', tool: 'foo' }])
    })

    it('does not rewrite an already-normalized registry', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('runs no mise/install commands during normalization', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.0.0' }])
      const service = new BinaryManager()

      await runAllReadyTasks(service)

      // Pure schema hygiene: it rewrites Preference but never shells out to mise
      // or touches binary files.
      expect(mockExecFileAsync).not.toHaveBeenCalled()
      expect(mockFs.existsSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [
        { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }
      ])
    })

    it('resolves without throwing when the Preference write fails, so startup is not bricked', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.0.0' }])
      mockPreferenceService.set.mockRejectedValue(new Error('preference write failed'))
      const service = new BinaryManager()

      await expect(runAllReadyTasks(service)).resolves.toBeUndefined()
    })

    it('skips scheduled normalization when the service stops before it starts', async () => {
      vi.useFakeTimers()
      try {
        setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.0.0' }])
        const service = new BinaryManager()

        expect((service as any).onAllReady()).toBeUndefined()
        await (service as any).onStop()
        await vi.runAllTimersAsync()

        expect(mockPreferenceService.set).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not queue normalization behind an active user mutation', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.0.0' }])
      const service = new BinaryManager()
      const releaseMutation = await (service as any).mutationMutex.acquire()

      try {
        await runAllReadyTasks(service)
        expect(mockPreferenceService.set).not.toHaveBeenCalled()
        await expect((service as any).onStop()).resolves.toBeUndefined()
      } finally {
        releaseMutation()
      }
    })

    it('waits for in-flight normalization during service stop', async () => {
      setRegistry([{ name: 'mytool', tool: 'npm:mytool', version: '1.0.0' }])
      let finishWrite!: () => void
      mockPreferenceService.set.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve
          })
      )
      const service = new BinaryManager()

      expect((service as any).onAllReady()).toBeUndefined()
      await vi.waitFor(() => expect(mockPreferenceService.set).toHaveBeenCalled())

      let stopped = false
      const stop = (service as any).onStop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      expect(stopped).toBe(false)

      finishWrite()
      await stop
      expect(stopped).toBe(true)
    })
  })

  describe('getToolSnapshots', () => {
    it('returns the requested, custom-defined, auto-runtime, and operation names from the custom registry and one mise refresh', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'myfd', tool: 'github:sharkdp/fd', requestedVersion: '10.0.0' }]
      MockMainCacheServiceUtils.setCacheValue('feature.binary.install_states', {
        later: {
          status: 'failed',
          action: 'install',
          error: 'offline'
        }
      })
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) =>
        [
          '/mock/feature.binary.data/shims/myfd',
          '/mock/feature.binary.data/shims/node',
          '/mock/cherry.bin/bun'
        ].includes(candidate)
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
          'github:sharkdp/fd': [{ version: '10.0.0', active: true }],
          node: [{ version: '22.0.0', active: true }]
        }),
        stderr: ''
      })

      await expect(service.getToolSnapshots(['bun', 'missing'])).resolves.toEqual({
        bun: {
          name: 'bun',
          availability: { source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' },
          application: { status: 'absent' }
        },
        missing: {
          name: 'missing',
          availability: { source: 'system', path: '/usr/local/bin/missing' },
          application: { status: 'absent' }
        },
        myfd: {
          name: 'myfd',
          definition: { name: 'myfd', tool: 'github:sharkdp/fd', requestedVersion: '10.0.0' },
          availability: {
            source: 'mise',
            path: '/mock/feature.binary.data/shims/myfd',
            version: '10.0.0'
          },
          application: { status: 'applied', version: '10.0.0' }
        },
        node: {
          name: 'node',
          availability: {
            source: 'mise',
            path: '/mock/feature.binary.data/shims/node',
            version: '22.0.0'
          },
          application: { status: 'applied', version: '22.0.0' }
        },
        // `later` is operation-only (no fixed/custom recipe), so it carries no
        // application fact — a snapshot can omit application for an unknown name.
        later: {
          name: 'later',
          availability: { source: 'none' },
          operation: {
            status: 'failed',
            action: 'install',
            error: 'offline'
          }
        }
      })
      expect(mockPreferenceService.get).toHaveBeenCalledTimes(1)
      expect(mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'ls')).toHaveLength(1)
      expect(mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'which')).toHaveLength(2)
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['ls', '--json'], expect.any(Object))
    })

    it('reports a requested unowned preset when batched mise ls and its shim agree', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
        stderr: ''
      })

      const snapshots = await service.getToolSnapshots(['fd'])

      expect(snapshots.fd).toEqual({
        name: 'fd',
        availability: { source: 'mise', path: '/mock/feature.binary.data/shims/fd', version: '10.0.0' },
        application: { status: 'applied', version: '10.0.0' }
      })
      expect(mockExecFileAsync).toHaveBeenCalledTimes(2)
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['which', 'fd'], expect.any(Object))
      expect(mockFsp.access).toHaveBeenCalledWith('/mock/feature.binary.data/shims/fd', mockFs.constants.X_OK)
    })

    it('stays applied when the active entry exposes an install_path the shim resolves within', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              fd: [{ version: '10.0.0', active: true, install_path: '/opt/mise/installs/fd/10.0.0' }]
            }),
            stderr: ''
          }
        }
        // The shim resolves to a binary inside this exact entry's install.
        if (args[0] === 'which') return { stdout: '/opt/mise/installs/fd/10.0.0/bin/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const snapshots = await service.getToolSnapshots(['fd'])

      expect(snapshots.fd).toEqual({
        name: 'fd',
        availability: { source: 'mise', path: '/mock/feature.binary.data/shims/fd', version: '10.0.0' },
        application: { status: 'applied', version: '10.0.0' }
      })
    })

    it('reports managed DeepSeek Harness as broken when its required scope package cannot resolve', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              'npm:@deepseek-ai/dsh': [{ version: '0.1.1-rc.2', active: true }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which') {
          return { stdout: '/opt/mise/installs/npm-deepseek-ai-dsh/0.1.1-rc.2/lib/bin.js\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      mockCreateRequire.mockImplementation((filename: string) => ({
        resolve: (request: string) => {
          if (request === '@deepseek-ai/dsh-agent-loop') {
            return '/opt/mise/installs/npm-deepseek-ai-dsh/0.1.1-rc.2/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js'
          }
          if (request === '@deepseek-ai/dsh-scope') {
            throw Object.assign(new Error(`Cannot find package ${request} from ${filename}`), {
              code: 'MODULE_NOT_FOUND'
            })
          }
          throw new Error(`Unexpected package resolution: ${request}`)
        }
      }))

      await expect(service.getToolSnapshots(['dsh'])).resolves.toMatchObject({
        dsh: {
          availability: { source: 'none' },
          application: { status: 'broken', version: '0.1.1-rc.2' }
        }
      })
    })

    it('stays applied when the recipe restructured away the package that hosts its required peer', async () => {
      // A renamed/absorbed host says the package graph moved on, not that this
      // install is incomplete — failing closed would strand the tool at broken
      // with a Retry that can never succeed.
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              'npm:@deepseek-ai/dsh': [{ version: '0.2.0', active: true }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which') {
          return { stdout: '/opt/mise/installs/npm-deepseek-ai-dsh/0.2.0/lib/bin.js\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      mockCreateRequire.mockImplementation((filename: string) => ({
        resolve: (request: string) => {
          throw Object.assign(new Error(`Cannot find package ${request} from ${filename}`), {
            code: 'MODULE_NOT_FOUND'
          })
        }
      }))

      await expect(service.getToolSnapshots(['dsh'])).resolves.toMatchObject({
        dsh: { application: { status: 'applied', version: '0.2.0' } }
      })
    })

    it('stays applied for a recipe with no eponymous bin, through a shim it does expose', async () => {
      // core:rust exposes rustc/cargo and no `rust`, so a name-keyed `mise which`
      // reports a working install as unusable (#19075).
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'rust', tool: 'core:rust' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              rust: [{ version: '1.98.0', active: true, install_path: '/mock/cargo/bin' }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which' && args[1] === 'rust') throw new Error('rust is not a mise bin')
        if (args[0] === 'which') return { stdout: `/mock/cargo/bin/${args[1]}\n`, stderr: '' }
        if (args[0] === 'bin-paths') {
          return {
            stdout: JSON.stringify([
              { name: 'cargo', path: '/mock/cargo/bin/cargo' },
              { name: 'rustc', path: '/mock/cargo/bin/rustc' }
            ]),
            stderr: ''
          }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.access as any).mockImplementation(async (candidate: string) => {
        if (candidate === '/mock/feature.binary.data/shims/rust') throw new Error('ENOENT')
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => ['cargo', 'rustc'])

      await expect(service.getToolSnapshots(['rust'])).resolves.toEqual({
        rust: {
          name: 'rust',
          definition: { name: 'rust', tool: 'core:rust' },
          availability: { source: 'mise', path: '/mock/feature.binary.data/shims/cargo', version: '1.98.0' },
          application: { status: 'applied', version: '1.98.0' }
        }
      })
    })

    it('reports broken when the exposed bin has a shim that is not executable', async () => {
      // `mise which` resolving the target says nothing about the shim Cherry puts
      // on PATH: a present-but-unexecutable shim is not a runnable path.
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'rust', tool: 'core:rust' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              rust: [{ version: '1.98.0', active: true, install_path: '/mock/cargo/bin' }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which' && args[1] === 'rust') throw new Error('rust is not a mise bin')
        if (args[0] === 'which') return { stdout: `/mock/cargo/bin/${args[1]}\n`, stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: '/mock/cargo/bin/cargo' }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.access as any).mockImplementation(async (candidate: string, mode: number) => {
        if (candidate === '/mock/feature.binary.data/shims/rust') throw new Error('ENOENT')
        // The shim file exists, but carries no execute bit.
        if (candidate === '/mock/feature.binary.data/shims/cargo' && mode === mockFs.constants.X_OK) {
          throw new Error('EACCES')
        }
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => ['cargo'])

      await expect(service.getToolSnapshots(['rust'])).resolves.toMatchObject({
        rust: {
          availability: { source: 'none' },
          application: { status: 'broken', version: '1.98.0' }
        }
      })
    })

    it('reports broken when no bin the recipe exposes has a shim', async () => {
      // The exposed-bin fallback must not turn a lost shim into a runnable tool:
      // with nothing shimmed, the recipe is not reachable on Cherry's PATH.
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'rust', tool: 'core:rust' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              rust: [{ version: '1.98.0', active: true, install_path: '/mock/cargo/bin' }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which' && args[1] === 'rust') throw new Error('rust is not a mise bin')
        if (args[0] === 'which') return { stdout: `/mock/cargo/bin/${args[1]}\n`, stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: '/mock/cargo/bin/cargo' }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.access as any).mockImplementation(async (candidate: string) => {
        if (candidate === '/mock/feature.binary.data/shims/rust') throw new Error('ENOENT')
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => [])

      await expect(service.getToolSnapshots(['rust'])).resolves.toMatchObject({
        rust: {
          availability: { source: 'none' },
          application: { status: 'broken', version: '1.98.0' }
        }
      })
    })

    it('stays applied when mise which resolves through its latest-version symlink', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              'github:larksuite/cli': [
                {
                  version: '1.0.77',
                  active: true,
                  install_path: '/opt/mise/installs/github-larksuite-cli/1.0.77'
                }
              ]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which') {
          return { stdout: '/opt/mise/installs/github-larksuite-cli/latest/lark-cli\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      mockFsp.realpath.mockImplementation(async (candidate: string) =>
        candidate.replace('/github-larksuite-cli/latest/', '/github-larksuite-cli/1.0.77/')
      )

      const snapshots = await service.getToolSnapshots(['lark-cli'])

      expect(snapshots['lark-cli']).toEqual({
        name: 'lark-cli',
        availability: {
          source: 'mise',
          path: '/mock/feature.binary.data/shims/lark-cli',
          version: '1.0.77'
        },
        application: { status: 'applied', version: '1.0.77' }
      })
      expect(mockFsp.realpath).toHaveBeenCalledWith('/opt/mise/installs/github-larksuite-cli/latest/lark-cli')
      expect(mockFsp.realpath).toHaveBeenCalledWith('/opt/mise/installs/github-larksuite-cli/1.0.77')
    })

    it('reports broken when an active entry shim resolves outside that entry install_path', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              fd: [{ version: '10.0.0', active: true, install_path: '/opt/mise/installs/fd/10.0.0' }]
            }),
            stderr: ''
          }
        }
        // The shim resolves to a same-named binary from a *different* backend install.
        if (args[0] === 'which') return { stdout: '/opt/other/backend/bin/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

      const snapshots = await service.getToolSnapshots(['fd'])

      // The exact recipe is installed, but its shim points at a foreign install —
      // calling this `applied` would grant Update/Uninstall over another backend's fd.
      expect(snapshots.fd.application).toEqual({ status: 'broken', version: '10.0.0' })
      expect(snapshots.fd.availability).toEqual({ source: 'system', path: '/usr/local/bin/fd' })
    })

    it('matches a fixed pipx recipe when mise omits its installation options', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'pipx:hermes-agent': [{ version: '0.19.0', active: true }] }), stderr: '' }
        }
        if (args[0] === 'which')
          return { stdout: '/mock/mise/installs/pipx-hermes-agent/0.19.0/bin/hermes\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const snapshots = await service.getToolSnapshots(['hermes'])

      expect(snapshots.hermes).toEqual({
        name: 'hermes',
        availability: { source: 'mise', path: '/mock/feature.binary.data/shims/hermes', version: '0.19.0' },
        application: { status: 'applied', version: '0.19.0' }
      })
    })

    it('matches a non-runtime fixed recipe when mise reports its core-prefixed identity', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ 'core:uv': [{ version: '0.9.0', active: true }] }),
        stderr: ''
      })

      const snapshots = await service.getToolSnapshots(['uv'])

      expect(snapshots.uv).toEqual({
        name: 'uv',
        availability: { source: 'mise', path: '/mock/feature.binary.data/shims/uv', version: '0.9.0' },
        application: { status: 'applied', version: '0.9.0' }
      })
    })

    it('reports broken and falls back externally when a matching mise shim is not executable', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
        stderr: ''
      })
      mockFsp.access.mockRejectedValue(new Error('EACCES'))
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

      // Exact recipe installed but shim not executable → broken with version, and
      // availability independently falls back to the external system source.
      await expect(service.getToolSnapshots(['fd'])).resolves.toMatchObject({
        fd: {
          availability: { source: 'system', path: '/usr/local/bin/fd' },
          application: { status: 'broken', version: '10.0.0' }
        }
      })
    })

    it('drops a stale failed install once the tool resolves on the system PATH', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      MockMainCacheServiceUtils.setCacheValue('feature.binary.install_states', {
        fd: { status: 'failed', action: 'install', error: 'offline' }
      })
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

      const snapshots = await service.getToolSnapshots(['fd'])

      expect(snapshots.fd.availability).toEqual({ source: 'system', path: '/usr/local/bin/fd' })
      // The out-of-band install satisfied the tool — no spurious retry survives.
      expect(snapshots.fd.operation).toBeUndefined()
    })

    it('keeps a failed install whose tool is present via mise so ownership retry survives', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      MockMainCacheServiceUtils.setCacheValue('feature.binary.install_states', {
        fd: { status: 'failed', action: 'install', error: 'manifest write failed' }
      })
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
        stderr: ''
      })

      const snapshots = await service.getToolSnapshots(['fd'])

      // Physically installed but manifest write failed — the retry claims ownership.
      expect(snapshots.fd.availability.source).toBe('mise')
      expect(snapshots.fd.operation).toMatchObject({ status: 'failed', action: 'install' })
    })

    it('drops a stale failed install once the tool resolves as a bundled binary', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      MockMainCacheServiceUtils.setCacheValue('feature.binary.install_states', {
        bun: { status: 'failed', action: 'install', error: 'offline' }
      })
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === '/mock/cherry.bin/bun')
      mockFs.readFileSync.mockImplementation((candidate: string) =>
        candidate === '/mock/cherry.bin/.bun-version'
          ? '1.2.3'
          : (() => {
              throw new Error('ENOENT')
            })()
      )
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })

      const snapshots = await service.getToolSnapshots(['bun'])

      // The bundled binary always works — a failed install over it is pure noise.
      expect(snapshots.bun.availability.source).toBe('bundled')
      expect(snapshots.bun.operation).toBeUndefined()
    })

    it('falls back from an owned missing mise shim to bundled, system, and none availability', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
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

      const snapshots = await service.getToolSnapshots(['bun', 'fd'])
      expect(snapshots.bun?.definition).toBeUndefined()
      expect(snapshots.fd?.definition).toBeUndefined()
      expect(snapshots.bun?.availability).toEqual({ source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' })
      expect(snapshots.fd?.availability).toEqual({ source: 'system', path: '/usr/local/bin/fd' })
      expect(snapshots.gone?.availability).toEqual({ source: 'none' })
    })

    it('publishes installing before a blocked mutation and lets snapshots read it without waiting', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      const release = await (service as any).mutationMutex.acquire()

      const pending = service.installByName({ name: 'fd' })
      await expect(service.getToolSnapshots([])).resolves.toMatchObject({
        fd: { operation: { status: 'installing' } }
      })
      release()
      await expect(pending).rejects.toThrow('mise did not report an installed version')
    })

    describe('application fact', () => {
      it('reports an active entry as broken when its shim target no longer resolves', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') {
            return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
          }
          if (args[0] === 'which') throw new Error('installed target is gone')
          return { stdout: '', stderr: '' }
        })
        vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

        await expect(service.getToolSnapshots(['fd'])).resolves.toMatchObject({
          fd: {
            availability: { source: 'system', path: '/usr/local/bin/fd' },
            application: { status: 'broken', version: '10.0.0' }
          }
        })
      })

      it('reports inactive-only entries as broken and ignores an unresolvable residual shim', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') {
            return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: false }] }), stderr: '' }
          }
          if (args[0] === 'which') throw new Error('tool fd not found')
          return { stdout: '', stderr: '' }
        })
        vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

        await expect(service.getToolSnapshots(['fd'])).resolves.toMatchObject({
          fd: {
            availability: { source: 'system', path: '/usr/local/bin/fd' },
            application: { status: 'broken', version: '10.0.0' }
          }
        })
      })

      it('keeps verified mise availability for an inactive-only entry without calling it applied', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') {
            return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: false }] }), stderr: '' }
          }
          if (args[0] === 'which') return { stdout: '/opt/mise/installs/fd/10.0.0/bin/fd\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

        await expect(service.getToolSnapshots(['fd'])).resolves.toMatchObject({
          fd: {
            availability: { source: 'mise', path: '/mock/feature.binary.data/shims/fd', version: '10.0.0' },
            application: { status: 'broken', version: '10.0.0' }
          }
        })
      })

      it('reports absent with no shim and an external fallback for an unbacked recipe', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
        vi.mocked(findCommandInShellEnv).mockResolvedValue(null)

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'none' },
          application: { status: 'absent' }
        })
        // No shim on disk → no `mise which` conflict probe runs.
        expect(mockExecFileAsync.mock.calls.some((call: any[]) => call[1][0] === 'which')).toBe(false)
      })

      it('reports a verified conflict with runnable mise availability when a foreign shim resolves without an exact recipe', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') return { stdout: '{}', stderr: '' }
          if (args[0] === 'which') return { stdout: '/opt/other/bin/fd\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

        const snapshots = await service.getToolSnapshots(['fd'])

        // No exact entries, but the shim resolves to a runnable target owned
        // elsewhere: runnable (availability=mise, no trusted version) yet not applied.
        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'mise', path: '/mock/feature.binary.data/shims/fd' },
          application: { status: 'conflict' }
        })
      })

      it('ignores a stale shim as absent and falls back externally when `mise which` fails', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') return { stdout: '{}', stderr: '' }
          if (args[0] === 'which') throw new Error('tool fd not found')
          return { stdout: '', stderr: '' }
        })
        vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'system', path: '/usr/local/bin/fd' },
          application: { status: 'absent' }
        })
      })

      it('ignores a stale shim whose which target is inaccessible (absent, none fallback)', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') return { stdout: '{}', stderr: '' }
          if (args[0] === 'which') return { stdout: '/opt/gone/fd\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })
        // The shim is executable, but the target returned by `mise which` is gone.
        ;(mockFsp.access as any).mockImplementation(async (candidate: string) => {
          if (candidate === '/opt/gone/fd') throw new Error('ENOENT')
        })
        vi.mocked(findCommandInShellEnv).mockResolvedValue(null)

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'none' },
          application: { status: 'absent' }
        })
      })

      it('reports unknown/backend_unavailable for every name and never runs mise when mise is missing', async () => {
        const service = new BinaryManager()
        // miseBin stays null.
        ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === '/mock/cherry.bin/bun')
        mockFs.readFileSync.mockImplementation((candidate: string) =>
          candidate === '/mock/cherry.bin/.bun-version'
            ? '1.2.3'
            : (() => {
                throw new Error('ENOENT')
              })()
        )
        vi.mocked(findCommandInShellEnv).mockResolvedValue(null)

        const snapshots = await service.getToolSnapshots(['bun', 'fd'])

        expect(mockExecFileAsync).not.toHaveBeenCalled()
        // Bundled/system availability is still resolved independently of the fact.
        expect(snapshots.bun).toEqual({
          name: 'bun',
          availability: { source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' },
          application: { status: 'unknown', reason: 'backend_unavailable' }
        })
        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'none' },
          application: { status: 'unknown', reason: 'backend_unavailable' }
        })
      })

      it('reports unknown/query_failed while bundled and system availability stay resolvable when mise ls rejects', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
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
        mockExecFileAsync.mockRejectedValue(new Error('mise ls boom'))

        const snapshots = await service.getToolSnapshots(['bun', 'fd'])

        expect(snapshots.bun).toEqual({
          name: 'bun',
          availability: { source: 'bundled', path: '/mock/cherry.bin/bun', version: '1.2.3' },
          application: { status: 'unknown', reason: 'query_failed' }
        })
        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'system', path: '/usr/local/bin/fd' },
          application: { status: 'unknown', reason: 'query_failed' }
        })
      })

      it('keeps verified mise availability independent when the full listing fails', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        ;(mockFs.existsSync as any).mockImplementation(
          (candidate: string) => candidate === '/mock/feature.binary.data/shims/fd'
        )
        mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
          if (args[0] === 'ls') throw new Error('mise ls boom')
          if (args[0] === 'which') return { stdout: '/opt/other/bin/fd\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'mise', path: '/mock/feature.binary.data/shims/fd' },
          application: { status: 'unknown', reason: 'query_failed' }
        })
      })

      it.each([
        ['a non-object', JSON.stringify(['not', 'an', 'object'])],
        ['invalid spec entries', JSON.stringify({ fd: {} })]
      ])('treats %s mise ls shape as query_failed, not absent', async (_case, stdout) => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        mockExecFileAsync.mockResolvedValue({ stdout, stderr: '' })
        vi.mocked(findCommandInShellEnv).mockResolvedValue(null)

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd).toEqual({
          name: 'fd',
          availability: { source: 'none' },
          application: { status: 'unknown', reason: 'query_failed' }
        })
      })

      it('preserves a non-semver active version in the applied fact', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        mockExecFileAsync.mockResolvedValue({
          stdout: JSON.stringify({ fd: [{ version: 'nightly-2026', active: true }] }),
          stderr: ''
        })

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd.application).toEqual({ status: 'applied', version: 'nightly-2026' })
        expect(snapshots.fd.availability).toEqual({
          source: 'mise',
          path: '/mock/feature.binary.data/shims/fd',
          version: 'nightly-2026'
        })
      })

      it('normalizes a core: runtime spec to its interpreter name for the applied fact', async () => {
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        manifestRef.value = [{ name: 'node', tool: 'core:node', requestedVersion: '22.0.0' }]
        mockExecFileAsync.mockResolvedValue({
          stdout: JSON.stringify({ 'core:node': [{ version: '22.0.0', active: true }] }),
          stderr: ''
        })

        const snapshots = await service.getToolSnapshots([])

        expect(snapshots.node).toEqual({
          name: 'node',
          definition: { name: 'node', tool: 'core:node', requestedVersion: '22.0.0' },
          availability: {
            source: 'mise',
            path: '/mock/feature.binary.data/shims/node',
            version: '22.0.0'
          },
          application: { status: 'applied', version: '22.0.0' }
        })
      })

      it('checks the mise shim with F_OK on Windows for the applied fact', async () => {
        platformMock.isWin = true
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
        mockExecFileAsync.mockResolvedValue({
          stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
          stderr: ''
        })

        const snapshots = await service.getToolSnapshots(['fd'])

        expect(snapshots.fd.application).toEqual({ status: 'applied', version: '10.0.0' })
        expect(mockFsp.access).toHaveBeenCalledWith('/mock/feature.binary.data/shims/fd.exe', mockFs.constants.F_OK)
      })
    })
  })

  describe('manifest transitions', () => {
    it('does not install managed tools during startup', async () => {
      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      const service = new BinaryManager()
      await (service as any).onInit()

      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })
  })

  describe('custom registry mutation safety', () => {
    it('serializes concurrent custom-tool writes without dropping either definition', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // Full listing reports both custom specs already installed, so each Add is a
        // persist-then-adopt no-op — the concurrency under test is the Preference
        // read-modify-write, not the backend install.
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              'npm:mytool': [{ version: '1.0.0', active: true }],
              'npm:other': [{ version: '1.0.0', active: true }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await Promise.all([
        service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' }),
        service.addCustomTool({ name: 'other', tool: 'npm:other' })
      ])

      expect(manifestRef.value).toEqual([
        { name: 'mytool', tool: 'npm:mytool' },
        { name: 'other', tool: 'npm:other' }
      ])
    })
  })

  describe('removeTool (fixed/custom + definition-only semantics)', () => {
    const makeService = () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      return service
    }
    const miseArgs = () => mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
    const operations = () => MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')

    it('rejects an unknown tool name that is neither fixed nor custom', async () => {
      await expect(makeService().removeTool({ name: 'nope' })).rejects.toThrow('Unknown tool')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('rejects a definition-only remove of a built-in fixed tool', async () => {
      await expect(makeService().removeTool({ name: 'fd', definitionOnly: true })).rejects.toThrow('built-in')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('uninstalls a fixed tool from the backend, writing no Preference and keeping its catalog identity', async () => {
      const service = makeService()
      let uninstalled = false
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'ls')
          return {
            stdout: uninstalled ? '{}' : JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }),
            stderr: ''
          }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        if (args[0] === 'uninstall') uninstalled = true
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'fd' })).resolves.toEqual({ status: 'removed' })

      expect(miseArgs()).toContainEqual(['unuse', '-g', 'fd'])
      expect(miseArgs()).toContainEqual(['uninstall', '--all', 'fd'])
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
      // A fixed tool is code-owned: it stays a resolvable catalog entry (UI card).
      expect((service as any).resolveFixedDefinition('fd')).toEqual({ name: 'fd', tool: 'fd' })
    })

    it('clears an already-absent fixed tool without any backend uninstall or Preference write', async () => {
      const service = makeService()
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })

      await expect(service.removeTool({ name: 'fd' })).resolves.toEqual({ status: 'removed' })

      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'fd'])
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('drops an external-only custom definition without touching the backend', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      vi.mocked(findCommandInShellEnv).mockResolvedValueOnce('/usr/local/bin/mytool')

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({ status: 'removed' })

      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'npm:mytool'])
      expect(mockPreferenceService.set).toHaveBeenCalledWith('feature.binary.tools', [])
      expect(manifestRef.value).toEqual([])
    })

    it('cleans the backend and then drops the definition for an applied custom tool', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      let uninstalled = false
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: uninstalled ? '{}' : JSON.stringify({ 'npm:mytool': [{ version: '1.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        if (args[0] === 'uninstall') uninstalled = true
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({ status: 'removed' })

      expect(miseArgs()).toContainEqual(['unuse', '-g', 'npm:mytool'])
      expect(miseArgs()).toContainEqual(['uninstall', '--all', 'npm:mytool'])
      expect(manifestRef.value).toEqual([])
    })

    it('blocks with a typed conflict and retains the definition when the recipe conflicts', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockFs.existsSync.mockImplementation((...args: unknown[]) => String(args[0]).includes('shims'))
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'which') return { stdout: '/some/other/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'conflict',
        message: expect.stringContaining('mytool')
      })
      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'npm:mytool'])
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({})
    })

    it('blocks with query_failed and retains the definition when the backend cannot be read', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') throw new Error('mise ls exploded')
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'query_failed',
        message: expect.stringContaining('mytool')
      })
      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'npm:mytool'])
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({})
    })

    it('blocks a runtime removal as query_failed when the dependent scan is unreadable', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'node', tool: 'core:node', requestedVersion: '22.0.0' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // The dependent scan is the `--installed` listing; make only it unreadable.
        if (args[0] === 'ls' && args.includes('--installed')) throw new Error('dependent scan failed')
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ node: [{ version: '22.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'node' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'query_failed',
        message: expect.stringContaining('dependent scan failed')
      })
      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'core:node'])
      expect(manifestRef.value).toEqual([{ name: 'node', tool: 'core:node', requestedVersion: '22.0.0' }])
      expect(operations()).toEqual({})
    })

    it('blocks a runtime removal with the installed dependents and retains its definition', async () => {
      const service = makeService()
      manifestRef.value = [
        { name: 'node', tool: 'core:node', requestedVersion: '22.0.0' },
        { name: 'ntn', tool: 'npm:ntn' }
      ]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return {
            stdout: JSON.stringify({
              node: [{ version: '22.0.0', active: true }],
              'npm:ntn': [{ version: '1.0.0' }]
            }),
            stderr: ''
          }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'node' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'dependency_blocked',
        dependents: ['ntn'],
        message: expect.stringContaining('ntn')
      })
      expect(miseArgs()).not.toContainEqual(['uninstall', '--all', 'core:node'])
      expect(manifestRef.value).toContainEqual({ name: 'node', tool: 'core:node', requestedVersion: '22.0.0' })
      expect(operations()).toEqual({})
    })

    it('does not treat a config-declared but uninstalled dependent as a runtime blocker', async () => {
      const service = makeService()
      manifestRef.value = [
        { name: 'node', tool: 'core:node', requestedVersion: '22.0.0' },
        { name: 'ntn', tool: 'npm:ntn' }
      ]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // Post-cleanup absence probe for the exact runtime spec.
        if (args[0] === 'ls' && args.includes('core:node')) return { stdout: '{}', stderr: '' }
        // Dependent scan uses --installed, so the config-only npm:ntn is filtered out.
        if (args[0] === 'ls' && args.includes('--installed'))
          return { stdout: JSON.stringify({ node: [{ version: '22.0.0', active: true }] }), stderr: '' }
        // Plain listing still surfaces npm:ntn as declared-but-not-installed.
        if (args[0] === 'ls')
          return {
            stdout: JSON.stringify({
              node: [{ version: '22.0.0', active: true }],
              'npm:ntn': [{ version: '1.0.0', installed: false }]
            }),
            stderr: ''
          }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'node' })).resolves.toEqual({ status: 'removed' })
      expect(miseArgs()).toContainEqual(['uninstall', '--all', 'core:node'])
    })

    it('blocks with cleanup_failed when a cleanup command fails, retaining the custom definition', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        if (args[0] === 'uninstall') throw new Error('uninstall exploded')
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'cleanup_failed',
        message: expect.stringContaining('uninstall exploded')
      })
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({})
    })

    it('blocks with cleanup_failed when the tool is still present after cleanup', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // Both the full snapshot and the post-cleanup absence probe still report it.
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'cleanup_failed',
        message: expect.stringContaining('still installed')
      })
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({})
    })

    it('drops only the definition on a definition-only custom remove, never touching the backend', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]

      await expect(service.removeTool({ name: 'mytool', definitionOnly: true })).resolves.toEqual({ status: 'removed' })

      expect(mockExecFileAsync).not.toHaveBeenCalled()
      expect(manifestRef.value).toEqual([])
    })

    it('keeps a committed definition removal successful when derived invalidation fails', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      const cacheService = application.get('CacheService')
      vi.mocked(cacheService.deleteShared).mockImplementationOnce(() => {
        throw new Error('cache unavailable')
      })

      await expect(service.removeTool({ name: 'mytool', definitionOnly: true })).resolves.toEqual({
        status: 'removed'
      })

      expect(manifestRef.value).toEqual([])
      expect(operations()).toEqual({})
    })

    it('rejects with a failed op on a Preference write failure, then converges on retry via the absent branch', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      mockPreferenceService.set.mockRejectedValueOnce(new Error('preference write failed'))

      await expect(service.removeTool({ name: 'mytool' })).rejects.toThrow('preference write failed')
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({
        mytool: { status: 'failed', action: 'remove', error: 'preference write failed' }
      })

      // Backend clean, definition still present: the retry re-enters the absent
      // branch, drops the definition, and converges.
      await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({ status: 'removed' })
      expect(manifestRef.value).toEqual([])
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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

      mockExecFileAsync.mockRejectedValue(new Error('unexpected argument --json'))

      await expect(service.searchRegistry('fd')).rejects.toThrow('unexpected argument --json')
    })

    it('rejects when the registry returns malformed JSON', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

      mockExecFileAsync.mockResolvedValue({ stdout: 'not json', stderr: '' })

      await expect(service.searchRegistry('fd')).rejects.toThrow()
    })
  })

  describe('getLatestVersions (applied fixed + custom scope)', () => {
    const makeService = () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      return service
    }

    const latestCalls = () =>
      mockExecFileAsync.mock.calls.filter((c: any[]) => c[1]?.[0] === 'latest').map((c: any[]) => c[1])

    // Mock a backend where `applied` maps recipe spec → installed version (each is
    // exactly applied), `latest` maps recipe spec → the latest version reported;
    // an omitted `latest` entry makes `mise latest` fail for that recipe.
    const mockBackend = (
      applied: Record<string, string>,
      latest: Record<string, string> = {},
      onLatest?: () => void
    ) => {
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) {
          const entries = Object.fromEntries(
            Object.entries(applied).map(([spec, version]) => [spec, [{ version, active: true }]])
          )
          return { stdout: JSON.stringify(entries), stderr: '' }
        }
        if (args[0] === 'latest') {
          onLatest?.()
          const version = latest[args[1]]
          if (version === undefined) throw new Error(`no latest for ${args[1]}`)
          return { stdout: `${version}\n`, stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/tool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })
    }

    it('returns empty map when mise binary is not available', async () => {
      const service = new BinaryManager()

      const result = await service.getLatestVersions()

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns the shared cache snapshot without running mise when force is false', async () => {
      MockMainCacheServiceUtils.setSharedCacheValue('feature.binary.latest_versions', { fd: '10.1.0' })
      const service = makeService()

      const result = await service.getLatestVersions()

      expect(result).toEqual({ fd: '10.1.0' })
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map on cache miss when force is false without running mise', async () => {
      const service = makeService()

      const result = await service.getLatestVersions()

      expect(result).toEqual({})
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('returns empty map and runs no mise latest when nothing is applied', async () => {
      const service = makeService()
      mockBackend({})

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(latestCalls()).toHaveLength(0)
    })

    it('queries latest only for applied fixed tools via their recipes', async () => {
      const service = makeService()
      mockBackend({ fd: '10.0.0', rg: '15.0.0' }, { fd: '10.1.0', rg: '15.1.0' })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ fd: '10.1.0', rg: '15.1.0' })
      expect(latestCalls()).toContainEqual(['latest', 'fd'])
      expect(latestCalls()).toContainEqual(['latest', 'rg'])
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({
        fd: '10.1.0',
        rg: '15.1.0'
      })
    })

    it('includes fresh prereleases when querying the latest DeepSeek Harness version', async () => {
      const service = makeService()
      mockBackend({ 'npm:@deepseek-ai/dsh': '0.1.0-rc.3' })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'npm:@deepseek-ai/dsh': [{ version: '0.1.0-rc.3', active: true }] }),
            stderr: ''
          }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/dsh\n', stderr: '' }
        if (args[0] === 'latest') return { stdout: '0.1.0-rc.6\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.getLatestVersions(true)).resolves.toMatchObject({ dsh: '0.1.0-rc.6' })

      const latestCall = mockExecFileAsync.mock.calls.find((call: any[]) => call[1][0] === 'latest')
      expect(latestCall?.[1]).toEqual(['latest', '--minimum-release-age', '0s', 'npm:@deepseek-ai/dsh'])
      expect(latestCall?.[2].env).toMatchObject({ MISE_PRERELEASES: '1' })
      expect(latestCall?.[2].env).not.toHaveProperty('MISE_NPM_SHELL_OUT')
    })

    it('includes an applied custom tool under its manifest name', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockBackend({ 'npm:mytool': '1.0.0' }, { 'npm:mytool': '1.2.0' })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ mytool: '1.2.0' })
      expect(latestCalls()).toContainEqual(['latest', 'npm:mytool'])
    })

    it('excludes tools that are not exactly applied', async () => {
      const service = makeService()
      // Only fd is applied; rg is absent from the backend, so it is never queried.
      mockBackend({ fd: '10.0.0' }, { fd: '10.1.0' })

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ fd: '10.1.0' })
      expect(latestCalls()).not.toContainEqual(['latest', 'rg'])
    })

    it('omits tools whose latest-version lookup fails', async () => {
      const service = makeService()
      mockBackend({ fd: '10.0.0', rg: '15.0.0' }, { fd: '10.1.0' }) // rg latest omitted → fails

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({ fd: '10.1.0' })
    })

    it('stores the result so the second non-force call reads it without re-running mise latest', async () => {
      const service = makeService()
      mockBackend({ fd: '10.0.0' }, { fd: '10.1.0' })

      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({ fd: '10.1.0' })
      const callsAfterFirst = latestCalls().length

      await service.getLatestVersions()
      expect(latestCalls().length).toBe(callsAfterFirst)
    })

    it('clears the shared cache on a manifest mutation so the next non-force call is empty', async () => {
      const service = makeService()
      mockBackend({ fd: '10.0.0' }, { fd: '10.1.0' })

      await service.getLatestVersions(true)
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toEqual({ fd: '10.1.0' })

      await (service as any).upsertCustomDefinition({ name: 'mytool', tool: 'npm:mytool' })
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toBeUndefined()

      const cached = await service.getLatestVersions()
      expect(cached).toEqual({})
    })

    it('deduplicates concurrent forced latest-version checks', async () => {
      const service = makeService()
      let resolveLatest!: () => void
      const gate = new Promise<void>((resolve) => {
        resolveLatest = resolve
      })
      // The single latest call awaits the gate, proving both callers share the one
      // in-flight batch.
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/installs/fd/10.0.0/bin/fd\n', stderr: '' }
        if (args[0] === 'latest') {
          await gate
          return { stdout: '10.1.0\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const both = Promise.all([service.getLatestVersions(true), service.getLatestVersions(true)])
      resolveLatest()
      const [first, second] = await both

      expect(first).toEqual({ fd: '10.1.0' })
      expect(second).toEqual({ fd: '10.1.0' })
      expect(latestCalls()).toHaveLength(1)
    })

    it('drops the result when a mutation lands during the batch (revision guard)', async () => {
      const service = makeService()
      // A mutation bumps the revision while the slow latest query runs, so the
      // batch is stale and neither returned nor cached.
      mockBackend({ fd: '10.0.0' }, { fd: '10.1.0' }, () => (service as any).bumpMutationRevision())

      const result = await service.getLatestVersions(true)

      expect(result).toEqual({})
      expect(MockMainCacheServiceUtils.getSharedCacheValue('feature.binary.latest_versions')).toBeUndefined()
    })
  })

  describe('validateBinaryToolDefinition', () => {
    it.each([
      ['../etc', 'fd', undefined],
      ['', 'fd', undefined],
      ['fd; rm -rf /', 'fd', undefined],
      ['fd\x00', 'fd', undefined],
      ['123fd', 'fd', undefined]
    ])('rejects invalid tool name=%j', (name, tool, version) => {
      expect(() => validateBinaryToolDefinition({ name, tool, requestedVersion: version })).toThrow('Invalid tool name')
    })

    it.each([
      ['fd', '', undefined],
      ['fd', 'tool; echo', undefined],
      ['fd', 'tool name', undefined],
      ['fd', '../../../etc/passwd', undefined],
      ['fd', 'github://evil', undefined],
      ['fd', '--verbose', undefined]
    ])('rejects invalid tool key=%j tool=%j', (name, tool, version) => {
      expect(() => validateBinaryToolDefinition({ name, tool, requestedVersion: version })).toThrow('Invalid tool key')
    })

    it.each([
      ['fd', 'fd', 'version; echo'],
      ['fd', 'fd', 'ver sion'],
      ['fd', 'fd', '-rf']
    ])('rejects invalid version=%j', (name, tool, version) => {
      expect(() => validateBinaryToolDefinition({ name, tool, requestedVersion: version })).toThrow(
        'Invalid tool version'
      )
    })

    it('accepts valid tool definitions', () => {
      expect(() => validateBinaryToolDefinition({ name: 'fd', tool: 'fd', requestedVersion: '10.0.0' })).not.toThrow()
      expect(() => validateBinaryToolDefinition({ name: 'ntn', tool: 'npm:ntn' })).not.toThrow()
    })

    it.each([
      [{ name: 'uv', tool: 'github:attacker/uv' }, 'canonical specification'],
      [{ name: 'codex', tool: 'npm:attacker-codex' }, 'canonical specification'],
      [{ name: 'node', tool: 'npm:attacker-node' }, 'canonical runtime specification'],
      [{ name: 'node-alt', tool: 'core:node' }, 'canonical runtime specification']
    ])('rejects reserved or aliased identities: %j', async (definition, message) => {
      // Custom Add is the only route that accepts an arbitrary recipe, so it is the
      // route whose validation enforces canonical/runtime identity.
      await expect(new BinaryManager().addCustomTool(definition)).rejects.toThrow(message)
    })
  })

  describe('fixed definition resolution', () => {
    it('resolves preset and Code CLI definitions from the code-owned catalog', () => {
      const service = new BinaryManager()

      expect((service as any).resolveFixedDefinition('uv')).toEqual({ name: 'uv', tool: 'uv' })
      expect((service as any).resolveFixedDefinition('claude')).toEqual({ name: 'claude', tool: 'claude' })
      expect((service as any).resolveFixedDefinition('gemini')).toEqual({
        name: 'gemini',
        tool: 'npm:@google/gemini-cli'
      })
    })

    it('returns undefined for a non-fixed name', () => {
      expect((new BinaryManager() as any).resolveFixedDefinition('mytool')).toBeUndefined()
    })
  })

  describe('applyDefinition (extracted install/claim primitive)', () => {
    it('claims a ready runtime at its live version without persisting', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/node\n', stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ node: [{ version: '22.23.1', active: true }] }), stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(
        (service as any).applyDefinition({ name: 'node', tool: 'core:node' }, undefined, [])
      ).resolves.toBeUndefined()

      // The primitive performs no persistence of its own and adopts the live
      // runtime without reinstalling.
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
      const miseArgs = mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
      expect(miseArgs.some((args: string[]) => args[0] === 'use')).toBe(false)
    })

    it('installs via mise honoring the one-shot target', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect((service as any).applyDefinition({ name: 'fd', tool: 'fd' }, '10.0.0', [])).resolves.toBeUndefined()

      const miseArgs = mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
      expect(miseArgs).toContainEqual(['use', '-g', 'fd@10.0.0'])
      expect(miseArgs).toContainEqual(['prune', 'fd'])
      expect(mockPreferenceService.set).not.toHaveBeenCalled()
    })

    it('passes a fixed npm lifecycle allowlist as typed mise tool options', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'npm:@vendor/native-cli': [{ version: '1.2.3', active: true }] }),
            stderr: ''
          }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/native-cli\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(
        (service as any).applyDefinition(
          {
            name: 'native-cli',
            tool: 'npm:@vendor/native-cli',
            npmAllowBuilds: ['@vendor/native-cli', 'better-sqlite3']
          },
          undefined,
          []
        )
      ).resolves.toBeUndefined()

      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual([
        'use',
        '-g',
        'node@22',
        'npm:@vendor/native-cli[allow_builds=["\\u0040vendor/native-cli","better-sqlite3"]]@latest'
      ])
    })

    it('accepts a recipe whose bins are not named after it (core:rust ships rustc/cargo)', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      const cargoBin = '/mock/feature.binary.data.isolated.cargo/bin'
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ rust: [{ version: '1.98.0', active: true, install_path: cargoBin }] }),
            stderr: ''
          }
        }
        // mise: "rust is not a mise bin" — the recipe exposes rustc/cargo instead.
        if (args[0] === 'which' && args[1] === 'rust') throw new Error('rust is not a mise bin')
        if (args[0] === 'which') return { stdout: `${cargoBin}/${args[1]}\n`, stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: `${cargoBin}/cargo` }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.access as any).mockImplementation(async (candidate: string) => {
        if (candidate === '/mock/feature.binary.data/shims/rust') throw new Error('ENOENT')
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => ['cargo', 'rustc'])

      await expect(
        (service as any).applyDefinition({ name: 'rust', tool: 'core:rust' }, undefined, [])
      ).resolves.toBeUndefined()
      // The exposed bin is verified for THIS recipe, not by bare name.
      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual([
        'which',
        'cargo',
        '--tool',
        'core:rust'
      ])
    })

    it('rejects an exposed binary that resolves outside the active install', async () => {
      // The bin a recipe exposes only counts when it resolves into THIS install —
      // otherwise a foreign provider on PATH would pass as a successful install.
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              rust: [{ version: '1.98.0', active: true, install_path: '/mock/managed/cargo/bin' }]
            }),
            stderr: ''
          }
        }
        if (args[0] === 'which' && args[1] === 'rust') throw new Error('rust is not a mise bin')
        if (args[0] === 'which') return { stdout: '/usr/local/bin/cargo\n', stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: '/mock/managed/cargo/bin/cargo' }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.access as any).mockImplementation(async (candidate: string) => {
        if (candidate === '/mock/feature.binary.data/shims/rust') throw new Error('ENOENT')
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => ['cargo'])

      await expect(
        (service as any).applyDefinition({ name: 'rust', tool: 'core:rust' }, undefined, [])
      ).rejects.toThrow('not runnable')
    })

    it('rejects when mise reports the installed version but no active entry', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({ fd: [{ version: '10.0.0' }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect((service as any).applyDefinition({ name: 'fd', tool: 'fd' }, undefined, [])).rejects.toThrow(
        'not runnable'
      )
    })

    it('rejects when the installed tool is not runnable', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect((service as any).applyDefinition({ name: 'fd', tool: 'fd' }, undefined, [])).rejects.toThrow(
        'not runnable'
      )
    })

    it('keeps a verified update successful when obsolete-version cleanup fails', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        if (args[0] === 'prune') throw new Error('cleanup failed')
        return { stdout: '', stderr: '' }
      })

      await expect((service as any).applyDefinition({ name: 'fd', tool: 'fd' }, '10.0.0', [])).resolves.toBeUndefined()

      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual(['prune', 'fd'])
    })
  })

  describe('installByName (name-only fixed/custom install)', () => {
    const makeService = () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      return service
    }
    const miseArgs = () => mockExecFileAsync.mock.calls.map((call: any[]) => call[1])

    it('rejects an unknown tool name without invoking the backend', async () => {
      await expect(makeService().installByName({ name: 'nope' })).rejects.toThrow('Unknown tool')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('ignores a stale fixed-name Preference recipe when deriving the snapshot', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'fd', tool: 'npm:evil' }]
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ 'npm:evil': [{ version: '9.9.9', active: true }] }),
        stderr: ''
      })

      const snapshots = await service.getToolSnapshots(['fd'])

      expect(snapshots.fd.definition).toBeUndefined()
      expect(snapshots.fd.application).toEqual({ status: 'absent' })
      expect(snapshots.fd.availability).toEqual({ source: 'none' })
    })

    it('applies an absent fixed recipe without writing Preference', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd' })

      expect(miseArgs()).toContainEqual(['use', '-g', 'fd@latest'])
      expect(mockPreferenceService.set).not.toHaveBeenCalledWith('feature.binary.tools', expect.anything())
      expect(manifestRef.value).toEqual([])
    })

    it('converges as a no-op when a mid-session system install appears in the refreshed env', async () => {
      const service = makeService()
      // The boot-time capture saw no fd; the user then installs one in another
      // terminal. The pre-decision refresh makes the new PATH visible, so the
      // install must converge on the external copy instead of laying down a
      // managed shadow.
      vi.mocked(refreshShellEnv).mockImplementation(async () => {
        vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')
        return { PATH: '/usr/local/bin:/usr/bin' }
      })
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({}), stderr: '' })

      await service.installByName({ name: 'fd' })

      expect(miseArgs().some((args: string[]) => args[0] === 'use')).toBe(false)
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('refreshes the login-shell capture before deciding to install', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd' })

      // Still absent after the fresh probe → the managed install proceeds.
      expect(vi.mocked(refreshShellEnv)).toHaveBeenCalled()
      expect(miseArgs()).toContainEqual(['use', '-g', 'fd@latest'])
    })

    it('is a no-op for an already-applied fixed tool and writes nothing', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd' })

      expect(miseArgs()).not.toContainEqual(['use', '-g', 'fd@latest'])
      expect(mockPreferenceService.set).not.toHaveBeenCalledWith('feature.binary.tools', expect.anything())
      expect(manifestRef.value).toEqual([])
    })

    it('repairs an inactive-only fixed recipe instead of treating it as already applied', async () => {
      const service = makeService()
      ;(mockFs.existsSync as any).mockImplementation((candidate: unknown) =>
        String(candidate).includes('/feature.binary.data/shims/fd')
      )
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) {
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: false }] }), stderr: '' }
        }
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/installs/fd/10.0.0/bin/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd' })

      expect(miseArgs()).toContainEqual(['use', '-g', 'fd@latest'])
      expect(mockPreferenceService.set).not.toHaveBeenCalledWith('feature.binary.tools', expect.anything())
    })

    it('applies a one-shot target update for an applied fixed tool without writing Preference', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '11.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd', targetVersion: '11.0.0' })

      expect(miseArgs()).toContainEqual(['use', '-g', 'fd@11.0.0'])
      expect(manifestRef.value).toEqual([])
    })

    it('retains the update target on a failed one-shot update so Retry repeats it', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // fd is applied at 10.0.0; the requested 11.0.0 update never lands.
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '10.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        if (args[0] === 'use') throw new Error('network is down')
        return { stdout: '', stderr: '' }
      })

      await expect(service.installByName({ name: 'fd', targetVersion: '11.0.0' })).rejects.toThrow('network is down')

      // Without the retained target, a name-only Retry would hit the applied
      // no-op and silently clear the failure without re-attempting the update.
      expect((await service.getToolSnapshots(['fd'])).fd.operation).toEqual({
        status: 'failed',
        action: 'install',
        error: 'network is down',
        targetVersion: '11.0.0'
      })
    })

    it('skips the managed install when an absent fixed tool is already on the system PATH', async () => {
      const service = makeService()
      vi.mocked(findCommandInShellEnv).mockResolvedValueOnce('/usr/local/bin/fd')
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'which') return { stdout: '', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'fd' })

      expect(miseArgs()).not.toContainEqual(['use', '-g', 'fd@latest'])
    })

    it('rejects a name-only install that resolves to a conflicting installation', async () => {
      const service = makeService()
      mockFs.existsSync.mockImplementation((...args: unknown[]) => String(args[0]).includes('shims'))
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'which') return { stdout: '/some/other/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('conflicting installation')
      expect((await service.getToolSnapshots(['fd'])).fd.operation).toEqual({
        status: 'failed',
        action: 'install',
        error: 'Tool fd resolves to a conflicting installation'
      })
      expect(miseArgs()).not.toContainEqual(['use', '-g', 'fd@latest'])
      expect(manifestRef.value).toEqual([])
    })

    it('keeps a failed operation when backend state is unknown but a system executable is available', async () => {
      const service = makeService()
      vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/fd')
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') throw new Error('mise ls exploded')
        return { stdout: '', stderr: '' }
      })

      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('Cannot determine')
      expect((await service.getToolSnapshots(['fd'])).fd).toMatchObject({
        availability: { source: 'system', path: '/usr/local/bin/fd' },
        application: { status: 'unknown', reason: 'query_failed' },
        operation: {
          status: 'failed',
          action: 'install',
          error: 'Cannot determine fd state: query_failed'
        }
      })
      expect(miseArgs()).not.toContainEqual(['use', '-g', 'fd@latest'])
      expect(manifestRef.value).toEqual([])
    })

    it('re-installs an owned custom tool by name without writing Preference or mutating its recipe', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'mytool' })

      expect(mockPreferenceService.set).not.toHaveBeenCalled()
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
    })

    it('uses the applied custom runtime active version instead of its portable default', async () => {
      const service = makeService()
      manifestRef.value = [
        { name: 'node', tool: 'core:node', requestedVersion: '20.0.0' },
        { name: 'mytool', tool: 'npm:mytool' }
      ]
      let installed = false
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({
              node: [{ version: '18.20.0', active: true }],
              ...(installed ? { 'npm:mytool': [{ version: '1.0.0', active: true }] } : {})
            }),
            stderr: ''
          }
        }
        if (args[0] === 'use') installed = true
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'mytool' })

      expect(miseArgs()).toContainEqual(['use', '-g', 'core:node@18.20.0', 'npm:mytool@latest'])
      expect(miseArgs()).not.toContainEqual(['use', '-g', 'core:node@20.0.0', 'npm:mytool@latest'])
    })

    it('does not adopt an unapplied custom runtime for a package install, using the default runtime', async () => {
      const service = makeService()
      manifestRef.value = [
        { name: 'node', tool: 'core:node', requestedVersion: '20.0.0' },
        { name: 'mytool', tool: 'npm:mytool' }
      ]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        // The custom node shim never resolves — it is defined but not applied.
        if (args[0] === 'which' && args[1] === 'node') return { stdout: '', stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'mytool' })

      expect(miseArgs()).toContainEqual(['use', '-g', 'node@22', 'npm:mytool@latest'])
      expect(miseArgs()).not.toContainEqual(['use', '-g', 'core:node@20.0.0', 'npm:mytool@latest'])
    })

    it('pins an exact healthy Node and puts its npm ahead of ambient PATH for DeepSeek Harness', async () => {
      const service = makeService()
      let installed = false
      ;(service as any).isolatedEnv = { env: { PATH: '/mock/mise/shims:/usr/bin' }, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'latest') return { stdout: '22.23.2\n', stderr: '' }
        if (args[0] === 'ls' && args.length === 2) {
          return {
            stdout: JSON.stringify(
              installed ? { 'npm:@deepseek-ai/dsh': [{ version: '0.1.0-rc.6', active: true }] } : {}
            ),
            stderr: ''
          }
        }
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'npm:@deepseek-ai/dsh': [{ version: '0.1.0-rc.6', active: true }] }),
            stderr: ''
          }
        }
        if (args.includes('npm:@deepseek-ai/dsh@latest')) installed = true
        if (args[0] === 'which' && args[1] === 'node') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/node\n', stderr: '' }
        }
        if (args[0] === 'which' && args[1] === 'npm') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/npm\n', stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/dsh\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.installByName({ name: 'dsh' })

      const useCalls = mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
      expect(useCalls.map((call: any[]) => call[1])).toEqual([
        ['use', '-g', '--pin', 'node@22.23.2'],
        ['use', '-g', '--minimum-release-age', '0s', 'npm:@deepseek-ai/dsh@latest']
      ])
      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual([
        'latest',
        '--minimum-release-age',
        '0s',
        'node@22'
      ])
      expect(useCalls[0]?.[2].env).not.toHaveProperty('MISE_NPM_SHELL_OUT')
      expect(useCalls[1]?.[2].env).toMatchObject({
        PATH: '/mock/mise/installs/node/22.23.2/bin:/mock/mise/shims:/usr/bin',
        MISE_PRERELEASES: '1',
        MISE_NPM_SHELL_OUT: '1',
        MISE_NPM_PACKAGE_MANAGER: 'npm'
      })
      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).not.toContainEqual([
        'install',
        '--force',
        'node@22.23.2'
      ])
    })

    it('repairs an applied DeepSeek Harness whose required scope package is missing', async () => {
      const service = makeService()
      let reinstalled = false
      ;(service as any).isolatedEnv = { env: { PATH: '/mock/mise/shims:/usr/bin' }, usesDefaultChinaPipIndex: false }
      mockCreateRequire.mockImplementation(() => ({
        resolve: (request: string) => {
          if (request === '@deepseek-ai/dsh-agent-loop') return '/mock/dsh-agent-loop/lib/index.js'
          if (request === '@deepseek-ai/dsh-scope' && !reinstalled) {
            throw Object.assign(new Error(`Cannot find package ${request}`), { code: 'MODULE_NOT_FOUND' })
          }
          if (request === '@deepseek-ai/dsh-scope') return '/mock/dsh-scope/lib/index.js'
          throw new Error(`Unexpected package resolution: ${request}`)
        }
      }))
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'latest') return { stdout: '22.23.2\n', stderr: '' }
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'npm:@deepseek-ai/dsh': [{ version: '0.1.1-rc.2', active: true }] }),
            stderr: ''
          }
        }
        if (args.includes('npm:@deepseek-ai/dsh@latest')) reinstalled = true
        if (args[0] === 'which' && args[1] === 'node') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/node\n', stderr: '' }
        }
        if (args[0] === 'which' && args[1] === 'npm') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/npm\n', stderr: '' }
        }
        if (args[0] === 'which') return { stdout: '/mock/dsh/lib/bin.js\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.installByName({ name: 'dsh' })).resolves.toBeUndefined()

      expect(reinstalled).toBe(true)
      expect(miseArgs()).toContainEqual(['use', '-g', '--minimum-release-age', '0s', 'npm:@deepseek-ai/dsh@latest'])
    })
  })

  describe('addCustomTool (persist-first custom add)', () => {
    const makeService = () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      return service
    }
    const miseArgs = () => mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
    const operations = () => MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')

    it('rejects a definition that reuses a built-in tool name', async () => {
      // Even with the built-in's own canonical recipe, a fixed name is reserved.
      await expect(makeService().addCustomTool({ name: 'fd', tool: 'fd' })).rejects.toThrow('built-in')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
      expect(manifestRef.value).toEqual([])
    })

    it('rejects a recipe already provided by a fixed definition under another name', async () => {
      await expect(makeService().addCustomTool({ name: 'myfd', tool: 'fd' })).rejects.toThrow('already provided by fd')
      expect(manifestRef.value).toEqual([])
    })

    it('rejects a core-prefixed alias of a fixed recipe', async () => {
      await expect(makeService().addCustomTool({ name: 'myuv', tool: 'core:uv' })).rejects.toThrow(
        'already provided by uv'
      )
      expect(manifestRef.value).toEqual([])
    })

    it('persists the definition and installs it via the default runtime', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })

      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(miseArgs()).toContainEqual(['use', '-g', 'node@22', 'npm:mytool@latest'])
      expect(operations()).toEqual({})
    })

    it('keeps the definition and records a failed operation when the backend install fails, still resolving', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'use') throw new Error('network down')
        return { stdout: '', stderr: '' }
      })

      await expect(service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })).resolves.toBeUndefined()

      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(operations()).toEqual({
        mytool: {
          status: 'failed',
          action: 'install',
          error: expect.stringContaining('network down')
        }
      })
    })

    it('aborts before any backend work and rejects when the Preference write fails', async () => {
      const service = makeService()
      mockPreferenceService.set.mockRejectedValueOnce(new Error('preference write failed'))
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({}), stderr: '' })

      await expect(service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })).rejects.toThrow(
        'preference write failed'
      )

      expect(miseArgs().some((args: string[]) => args[0] === 'use')).toBe(false)
      expect(manifestRef.value).toEqual([])
      expect(operations()).toEqual({})
    })

    it('is a no-op that keeps the definition when the custom tool is already applied', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })

      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(miseArgs()).not.toContainEqual(['use', '-g', 'node@22', 'npm:mytool@latest'])
      expect(operations()).toEqual({})
    })

    it('adopts a mid-session external copy from the refreshed env instead of installing a shadow', async () => {
      const service = makeService()
      // Same stale-PATH guard as installByName: the external copy only becomes
      // visible after the pre-decision refresh, and Custom Add must then keep
      // the definition without laying down a managed copy.
      vi.mocked(refreshShellEnv).mockImplementation(async () => {
        vi.mocked(findCommandInShellEnv).mockResolvedValue('/usr/local/bin/mytool')
        return { PATH: '/usr/local/bin:/usr/bin' }
      })
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({}), stderr: '' })

      await service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })

      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
      expect(miseArgs().some((args: string[]) => args[0] === 'use')).toBe(false)
      expect(operations()).toEqual({})
    })

    it('runs the targeted install when the tool is applied at a version that mismatches the request', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // Snapshot listing: 1.0.0 is active; post-install resolution sees 2.0.0.
        if (args[0] === 'ls' && args.length === 2)
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'ls')
          return {
            stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0' }, { version: '2.0.0', active: true }] }),
            stderr: ''
          }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mytool', tool: 'npm:mytool', requestedVersion: '2.0.0' })

      // `applied` at 1.0.0 must not swallow a 2.0.0 request: the definition is
      // persisted AND the targeted backend install runs.
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool', requestedVersion: '2.0.0' }])
      expect(mockExecFileAsync.mock.calls.map((call: any[]) => call[1])).toContainEqual([
        'use',
        '-g',
        'node@22',
        'npm:mytool@2.0.0'
      ])
      expect(operations()).toEqual({})
    })

    it('short-circuits without backend work when the applied version already satisfies the request', async () => {
      const service = makeService()
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '2.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mytool', tool: 'npm:mytool', requestedVersion: '2.0.0' })

      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool', requestedVersion: '2.0.0' }])
      expect(
        mockExecFileAsync.mock.calls.map((call: any[]) => call[1]).some((args: string[]) => args[0] === 'use')
      ).toBe(false)
      expect(operations()).toEqual({})
    })

    it('allows an idempotent retry of the identical definition', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: JSON.stringify({}), stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mytool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mytool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await expect(service.addCustomTool({ name: 'mytool', tool: 'npm:mytool' })).resolves.toBeUndefined()
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
    })

    it('rejects a same-name definition with a divergent recipe', async () => {
      const service = makeService()
      manifestRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
      await expect(service.addCustomTool({ name: 'mytool', tool: 'npm:other' })).rejects.toThrow(
        'different specification'
      )
      expect(manifestRef.value).toEqual([{ name: 'mytool', tool: 'npm:mytool' }])
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
        const { env } = await (service as any).buildIsolatedEnv()

        expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined()
        expect(env['OPENAI_API_KEY']).toBeUndefined()
        expect(env['SECRET_TOKEN']).toBeUndefined()
        expect(env['MISE_DATA_DIR']).toBeDefined()
      } finally {
        process.env = original
      }
    })

    it('pins rustup/cargo homes to the same dirs the execution env uses', async () => {
      // rustup keeps its toolchains outside MISE_DATA_DIR. If the install
      // subprocess and the launched tools disagree on these homes, cargo/rustc
      // find no toolchain and re-download it into the user's real home.
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const { env } = await (service as any).buildIsolatedEnv()
      const execution = getBinaryExecutionEnv()

      expect(env['MISE_RUSTUP_HOME']).toBe(execution['MISE_RUSTUP_HOME'])
      expect(env['MISE_CARGO_HOME']).toBe(execution['MISE_CARGO_HOME'])
      expect(execution['MISE_CARGO_HOME']).toBe('/mock/feature.binary.data.isolated.cargo')
    })

    it('passes through whitelisted variables but not the ambient auth token', async () => {
      const original = { ...process.env }
      try {
        process.env['GITHUB_TOKEN'] = 'ghp_test'
        process.env['HTTPS_PROXY'] = 'http://proxy:8080'
        delete process.env['CHERRY_GITHUB_TOKEN']

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const { env } = await (service as any).buildIsolatedEnv()

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
        const { env } = await (service as any).buildIsolatedEnv()

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
        const { env } = await (service as any).buildIsolatedEnv()

        expect(env['PATH'].split(':')).toEqual(['/mock/feature.binary.data/shims', '/mock/bin', '/usr/bin', '/bin'])
      } finally {
        process.env = original
      }
    })

    it('forces pipx tools through the bundled uv/uvx runtime', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      const { env } = await (service as any).buildIsolatedEnv()

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
      const { env } = await (service as any).buildIsolatedEnv()

      expect(mockPreferenceService.get).toHaveBeenCalledWith('feature.binary.install_settings')
      expect(env['NPM_CONFIG_REGISTRY']).toBe('https://registry.example')
      expect(env['PIP_INDEX_URL']).toBe('https://pypi.example/simple')
      expect(env['MISE_PIPX_REGISTRY_URL']).toBe('https://pypi.example/simple/{}/')
      expect(env['UV_DEFAULT_INDEX']).toBe('https://pypi.example/simple')
      expect(env['GITHUB_TOKEN']).toBe('ghp_settings')
      expect(JSON.parse(env['MISE_URL_REPLACEMENTS'])['https://github.com']).toBe(
        'https://ghfast.top/https://github.com'
      )
      expect(env['MISE_AQUA_COSIGN']).toBe('false')
      expect(env['MISE_AQUA_GITHUB_ATTESTATIONS']).toBe('false')
      expect(getBinaryExecutionEnv()['GITHUB_TOKEN']).toBeUndefined()
    })

    it('falls back to a valid ambient PIP_INDEX_URL when no pip index is configured', async () => {
      const original = { ...process.env }
      try {
        process.env['PIP_INDEX_URL'] = 'https://pypi.ambient/simple/'
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const { env } = await (service as any).buildIsolatedEnv()

        expect(env['PIP_INDEX_URL']).toBe('https://pypi.ambient/simple')
        expect(env['MISE_PIPX_REGISTRY_URL']).toBe('https://pypi.ambient/simple/{}/')
        expect(env['UV_DEFAULT_INDEX']).toBe('https://pypi.ambient/simple')
      } finally {
        process.env = original
      }
    })

    it('tolerates an invalid ambient PIP_INDEX_URL instead of bricking every mise operation', async () => {
      const original = { ...process.env }
      try {
        // A file:// pip index in the user's login shell must not abort the env
        // build and surface as a misleading "pip index" error on every install.
        process.env['PIP_INDEX_URL'] = 'file:///srv/pypi/simple'
        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'

        const { env } = await (service as any).buildIsolatedEnv()

        // Raw value passes through unchanged; no pipx registry is derived from it.
        expect(env['PIP_INDEX_URL']).toBe('file:///srv/pypi/simple')
        expect(env['MISE_PIPX_REGISTRY_URL']).toBeUndefined()
      } finally {
        process.env = original
      }
    })

    it('still rejects an explicitly configured non-HTTP pip index', async () => {
      mockInstallPreferences({ ...DEFAULT_INSTALL_PREFERENCES, pipIndexUrl: 'file:///srv/pypi/simple' })
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      await expect((service as any).buildIsolatedEnv()).rejects.toThrow('pip index must be a valid HTTP(S) URL')
    })

    it('rejects a configured registry URL with embedded credentials without echoing them', async () => {
      mockInstallPreferences({
        ...DEFAULT_INSTALL_PREFERENCES,
        npmRegistry: 'https://user:hunter2@registry.example'
      })
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      // Credentials in a registry URL could be echoed back through mise stderr
      // into renderer-visible operation errors and logs — reject at the source,
      // and keep the secret out of the rejection message itself.
      const failure = await (service as any).buildIsolatedEnv().then(
        () => null,
        (err: Error) => err
      )
      expect(failure?.message).toContain('npm registry must not contain embedded credentials')
      expect(failure?.message).not.toContain('hunter2')
    })

    it('relocates HOME/XDG into the isolated data dir so mise cannot read user-level config/creds', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const { env } = await (service as any).buildIsolatedEnv()

      // Install subprocess MUST be isolated from the user's real home.
      expect(env['HOME']).toBe('/mock/feature.binary.data/home')
      expect(env['XDG_CONFIG_HOME']).toBe('/mock/feature.binary.data/xdg/config')
      expect(env['XDG_CACHE_HOME']).toBe('/mock/feature.binary.data/xdg/cache')
      expect(env['XDG_STATE_HOME']).toBe('/mock/feature.binary.data/xdg/state')
    })
  })

  describe('installWithMise', () => {
    const UV_BIN = '/mock/cherry.bin/uv'
    const MANAGED_PYTHON = '/mock/feature.binary.data.uv_python/cpython-3.12.13/bin/python'
    const BABELDOC = { name: 'babeldoc-stream', tool: 'pipx:babeldoc-stream' }
    const uvCalls = (subcommand: string) =>
      mockExecFileAsync.mock.calls.filter(
        (call: any[]) => call[0] === UV_BIN && call[1][0] === 'python' && call[1][1] === subcommand
      )
    const miseUseCalls = () => mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
    const miseArgs = () => mockExecFileAsync.mock.calls.map((call: any[]) => call[1])

    // Drives a BabelDOC install that finds a healthy Cherry-managed interpreter.
    const stubManagedPythonInstall = () => {
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === UV_BIN)
      mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
        if (bin === UV_BIN && args[1] === 'find') return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
        if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
        if (args[0] === 'ls' && args[2] === 'pipx:babeldoc-stream') {
          return {
            stdout: JSON.stringify({ 'pipx:babeldoc-stream': [{ version: '0.6.4.post4', active: true }] }),
            stderr: ''
          }
        }
        return { stdout: '', stderr: '' }
      })
    }

    it('installs BabelDOC against an interpreter already in Cherry storage, without naming Python to mise', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {
        env: { PIP_INDEX_URL: 'https://pypi.org/simple' },
        usesDefaultChinaPipIndex: false
      }
      stubManagedPythonInstall()

      await expect((service as any).installWithMise(BABELDOC, undefined, [])).resolves.toBe('0.6.4.post4')

      expect(uvCalls('install')).toHaveLength(0)
      // Naming a Python runtime here is what makes mise download its own from
      // GitHub — the one thing this whole path exists to avoid.
      const useCall = miseUseCalls()[0]
      expect(useCall?.[1].some((arg: string) => arg.startsWith('python@'))).toBe(false)
      expect(useCall?.[2].env).toMatchObject({ UV_PYTHON: MANAGED_PYTHON, UV_PYTHON_DOWNLOADS: 'never' })
    })

    // An older Cherry version passed `python@3.12` to `mise use`, which wrote a
    // global selection Cherry no longer owns. `--no-prune` is load-bearing:
    // without it `mise unuse` uninstalls the interpreter, and the tools that
    // older version installed hold a `pyvenv.cfg` pointing into that directory.
    it('drops the global Python selection an older version wrote, without uninstalling it', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      stubManagedPythonInstall()

      await (service as any).installWithMise(BABELDOC, undefined, [])

      expect(miseArgs()).toContainEqual(['unuse', '-g', '--no-prune', 'python'])
    })

    it('leaves a Python the user added as a custom tool selected', async () => {
      manifestRef.value = [{ name: 'python', tool: 'core:python', requestedVersion: '3.13.0' }]
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      stubManagedPythonInstall()

      await (service as any).installWithMise(BABELDOC, undefined, [])

      expect(miseArgs()).not.toContainEqual(['unuse', '-g', '--no-prune', 'python'])
    })

    it('keeps a BabelDOC install that succeeded when the selection cannot be dropped', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      stubManagedPythonInstall()
      const stubbed = mockExecFileAsync.getMockImplementation()!
      mockExecFileAsync.mockImplementation(async (bin: string, args: string[], opts: any) => {
        if (args[0] === 'unuse') throw new Error('mise config is read-only')
        return stubbed(bin, args, opts)
      })

      await expect((service as any).installWithMise(BABELDOC, undefined, [])).resolves.toBe('0.6.4.post4')
    })

    it('preserves and sanitizes command stderr when every pip source fails', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {
        env: { PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
        usesDefaultChinaPipIndex: true
      }
      mockExecFileAsync.mockRejectedValue(
        Object.assign(new Error('Command failed'), {
          stderr: 'download https://user:password@mirror.test/file?api_key=hidden failed\n'
        })
      )

      await expect(
        (service as any).installPipxTool(['use', '-g', 'pipx:babeldoc-stream@0.6.4.post4'], MANAGED_PYTHON, false)
      ).rejects.toThrow(/Command failed[\s\S]*https:\/\/\*\*\*@mirror\.test\/file\?api_key=\*\*\*/)
    })

    it.each([
      { name: 'resolved latest', definitions: [], runtimeSpec: 'node@22.23.2', resolvesLatest: true },
      {
        name: 'applied custom pin',
        definitions: [{ name: 'node', tool: 'core:node', requestedVersion: '22.23.2' }],
        runtimeSpec: 'core:node@22.23.2',
        resolvesLatest: false
      }
    ])('force-reinstalls the $name exact Node version when its launchers are broken', async (testCase) => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: { PATH: '/mock/mise/shims:/usr/bin' }, usesDefaultChinaPipIndex: false }
      let runtimeReinstalled = false

      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'latest') return { stdout: '22.23.2\n', stderr: '' }
        if (args[0] === 'install' && args[1] === '--force') {
          runtimeReinstalled = true
          return { stdout: '', stderr: '' }
        }
        if (args[0] === 'which' && args.includes('--tool') && !runtimeReinstalled) {
          throw new Error('broken exact runtime')
        }
        if (args[0] === 'which' && args[1] === 'node') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/node\n', stderr: '' }
        }
        if (args[0] === 'which' && args[1] === 'npm') {
          return { stdout: '/mock/mise/installs/node/22.23.2/bin/npm\n', stderr: '' }
        }
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'npm:@deepseek-ai/dsh': [{ version: '0.1.0-rc.6', active: true }] }),
            stderr: ''
          }
        }
        return { stdout: '', stderr: '' }
      })

      await expect(
        (service as any).installWithMise(
          { name: 'dsh', tool: 'npm:@deepseek-ai/dsh', requestedVersion: 'latest' },
          undefined,
          testCase.definitions
        )
      ).resolves.toBe('0.1.0-rc.6')

      const calls = mockExecFileAsync.mock.calls.map((call: any[]) => call[1])
      expect(calls).toContainEqual(['install', '--force', testCase.runtimeSpec])
      expect(calls.filter((args: string[]) => args[0] === 'use' && args.includes(testCase.runtimeSpec))).toHaveLength(2)
      expect(calls.some((args: string[]) => args[0] === 'latest')).toBe(testCase.resolvesLatest)
      const installCall = mockExecFileAsync.mock.calls.find((call: any[]) =>
        call[1].includes('npm:@deepseek-ai/dsh@latest')
      )
      expect(installCall?.[2].env).toMatchObject({
        PATH: '/mock/mise/installs/node/22.23.2/bin:/mock/mise/shims:/usr/bin',
        MISE_NPM_PACKAGE_MANAGER: 'npm'
      })
    })

    it('uses mise global config and reshim for npm: backend tools', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      // Custom Add persists then applies via mise, exercising installWithMise.
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args.length === 2) return { stdout: '{}', stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ 'npm:mynpmtool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/mynpmtool\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mynpmtool', tool: 'npm:mynpmtool', requestedVersion: '1.0.0' })

      expect(manifestRef.value).toEqual([{ name: 'mynpmtool', tool: 'npm:mynpmtool', requestedVersion: '1.0.0' }])
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      // Installs may download a runtime (node/python) — they get the long
      // budget, unlike query commands which keep the 120s default.
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['use', '-g', 'node@22', 'npm:mynpmtool@1.0.0'], {
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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'node', tool: 'core:node', requestedVersion: '20.19.4' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        // node is applied at its live version, so the package install adopts it.
        if (args[0] === 'ls' && args[2] === 'npm:mynpmtool') {
          return { stdout: JSON.stringify({ 'npm:mynpmtool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        }
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'core:node': [{ version: '20.19.4', active: true }] }), stderr: '' }
        }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mynpmtool', tool: 'npm:mynpmtool', requestedVersion: '1.0.0' })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        '/mock/mise',
        ['use', '-g', 'core:node@20.19.4', 'npm:mynpmtool@1.0.0'],
        expect.objectContaining({ timeout: 900_000 })
      )
    })

    it('pins an unpinned owned runtime to its live version for a package install', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      manifestRef.value = [{ name: 'node', tool: 'core:node' }]
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls' && args[2] === 'npm:mynpmtool') {
          return { stdout: JSON.stringify({ 'npm:mynpmtool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        }
        // The owned node runtime is unpinned but applied; its live version drives the install.
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'core:node': [{ version: '20.19.4', active: true }] }), stderr: '' }
        }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })

      await service.addCustomTool({ name: 'mynpmtool', tool: 'npm:mynpmtool', requestedVersion: '1.0.0' })

      // addCustomTool does not rewrite node's persisted definition; only the mise
      // `use` command's runtime arg is pinned to the live version.
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        '/mock/mise',
        ['use', '-g', 'core:node@20.19.4', 'npm:mynpmtool@1.0.0'],
        expect.objectContaining({ timeout: 900_000 })
      )
    })

    it('normalizes a leading-v pin from verified mise output', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'not json', stderr: '' })

      await expect(
        (service as any).installWithMise({ name: 'fd', tool: 'fd', requestedVersion: '1.2.3' }, undefined, [])
      ).rejects.toThrow()
    })
  })

  describe('pipx index fallback', () => {
    const TSINGHUA = 'https://pypi.tuna.tsinghua.edu.cn/simple'
    const TENCENT = 'https://mirrors.cloud.tencent.com/pypi/simple'
    const OFFICIAL = 'https://pypi.org/simple'
    const UV_BIN = '/mock/cherry.bin/uv'
    const MANAGED_PYTHON = '/mock/feature.binary.data.uv_python/cpython-3.12.13/bin/python'

    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
      originalEnv = { ...process.env }
      // An ambient index on the dev machine would look like a user-chosen one.
      delete process.env['PIP_INDEX_URL']
      vi.mocked(regionService.isInChina).mockResolvedValue(true)
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === UV_BIN)
    })

    afterEach(() => {
      process.env = originalEnv
    })

    // The index each `use` attempt actually targeted, in attempt order.
    const attemptedIndexes = () =>
      mockExecFileAsync.mock.calls
        .filter((call: any[]) => call[1][0] === 'use')
        .map((call: any[]) => call[2].env['UV_DEFAULT_INDEX'])

    const stubMise = (failing: string[]) => {
      mockExecFileAsync.mockImplementation(async (bin: string, args: string[], opts: any) => {
        if (bin === UV_BIN && args[1] === 'find') return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
        if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
        if (args[0] === 'use') {
          const index = opts.env['UV_DEFAULT_INDEX'] ?? opts.env['PIP_INDEX_URL']
          if (failing.includes(index)) throw new Error(`No matching distribution on ${index}`)
          return { stdout: '', stderr: '' }
        }
        if (args[0] === 'ls') {
          return {
            stdout: JSON.stringify({ 'pipx:babeldoc-stream': [{ version: '0.6.4', active: true }] }),
            stderr: ''
          }
        }
        return { stdout: '', stderr: '' }
      })
    }

    const installBabeldoc = (service: InstanceType<typeof BinaryManager>) =>
      (service as any).installWithMise(
        { name: 'babeldoc', tool: 'pipx:babeldoc-stream', requestedVersion: '0.6.4' },
        undefined,
        []
      )

    const chinaService = () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      return service
    }

    // The production callback that a change to any install-affecting preference
    // fires: it discards the memoized env build without cancelling it.
    const invalidateOn = (service: InstanceType<typeof BinaryManager>) => {
      ;(service as any).registerPreferenceInvalidation()
      const calls = mockPreferenceService.subscribeMultipleChanges.mock.calls as unknown as Array<
        [string[], () => void]
      >
      return calls[calls.length - 1][1]
    }

    it('retries the next mirror when the default China index lags the release', async () => {
      const service = chinaService()
      stubMise([TSINGHUA])

      await expect(installBabeldoc(service)).resolves.toBe('0.6.4')
      expect(attemptedIndexes()).toEqual([TSINGHUA, TENCENT])
      // Switching index must not cost the retry Cherry's own interpreter —
      // without UV_PYTHON, mise falls back to downloading a Python from GitHub.
      for (const call of mockExecFileAsync.mock.calls.filter((entry: any[]) => entry[1][0] === 'use')) {
        expect(call[2].env).toMatchObject({ UV_PYTHON: MANAGED_PYTHON, UV_PYTHON_DOWNLOADS: 'never' })
      }
    })

    it('reaches pypi.org only after every China mirror has failed', async () => {
      const service = chinaService()
      stubMise([TSINGHUA, TENCENT])

      await expect(installBabeldoc(service)).resolves.toBe('0.6.4')
      expect(attemptedIndexes()).toEqual([TSINGHUA, TENCENT, OFFICIAL])
    })

    it('names every index it tried when none of them can install', async () => {
      const service = chinaService()
      stubMise([TSINGHUA, TENCENT, OFFICIAL])

      await expect(installBabeldoc(service)).rejects.toThrow(
        /pypi\.tuna\.tsinghua\.edu\.cn:[\s\S]*mirrors\.cloud\.tencent\.com:[\s\S]*pypi\.org:/
      )
    })

    it.each([
      { name: 'the user chose their own index', inChina: true, pipIndexUrl: 'https://pypi.internal/simple' },
      { name: 'the user is not in China', inChina: false, pipIndexUrl: '' }
    ])('does not reach for another index when $name', async ({ inChina, pipIndexUrl }) => {
      vi.mocked(regionService.isInChina).mockResolvedValue(inChina)
      mockInstallPreferences({ ...DEFAULT_INSTALL_PREFERENCES, pipIndexUrl })
      const service = chinaService()
      // Every index fails, so a fallback would show up as extra attempts.
      stubMise([TSINGHUA, TENCENT, OFFICIAL, pipIndexUrl, undefined as any])

      await expect(installBabeldoc(service)).rejects.toThrow()
      const useCalls = mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
      expect(useCalls).toHaveLength(1)
      // A chosen index must displace pypi.org inside uv, not merely sit beside it.
      expect(useCalls[0][2].env['UV_DEFAULT_INDEX']).toBe(pipIndexUrl || undefined)
    })

    it('leaves npm-backend installs on their single runtime-scoped attempt', async () => {
      const service = chinaService()
      stubMise([])
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') {
          return { stdout: JSON.stringify({ 'npm:mynpmtool': [{ version: '1.0.0', active: true }] }), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      await expect(
        (service as any).installWithMise(
          { name: 'mynpmtool', tool: 'npm:mynpmtool', requestedVersion: '1.0.0' },
          undefined,
          []
        )
      ).resolves.toBe('1.0.0')

      const useCalls = mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
      expect(useCalls).toHaveLength(1)
      expect(useCalls[0][2].env['UV_DEFAULT_INDEX']).toBeUndefined()
    })

    it('ignores a superseded env build that finishes after the user picked their own index', async () => {
      const CUSTOM = 'https://pypi.internal/simple'
      const { regionService } = await import('@main/services/RegionService')
      let finishSupersededLookup!: (inChina: boolean) => void
      vi.mocked(regionService.isInChina).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSupersededLookup = resolve
          })
      )

      const service = chinaService()
      const invalidate = invalidateOn(service)
      stubMise([])
      // Parked on its region lookup, this build still reads the old preference:
      // no configured index, so it resolves to Cherry's own China default.
      const superseded = (service as any).getIsolatedEnv()

      mockInstallPreferences({ ...DEFAULT_INSTALL_PREFERENCES, pipIndexUrl: CUSTOM })
      invalidate()

      // The replacement build wins the cache first; the superseded one lands after.
      await (service as any).getIsolatedEnv()
      finishSupersededLookup(true)
      await superseded

      await expect(installBabeldoc(service)).resolves.toBe('0.6.4')

      const useCalls = mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
      expect(useCalls).toHaveLength(1)
      expect(useCalls[0][2].env['PIP_INDEX_URL']).toBe(CUSTOM)
      expect(useCalls[0][2].env['UV_DEFAULT_INDEX']).toBe(CUSTOM)
    })

    it('runs every attempt of one install against the same env, even if settings change mid-retry', async () => {
      const service = chinaService()
      const invalidate = invalidateOn(service)
      stubMise([TSINGHUA])
      const runMise = mockExecFileAsync.getMockImplementation()!
      mockExecFileAsync.mockImplementation(async (bin: string, args: string[], opts: any) => {
        if (args[0] === 'use' && opts.env['UV_DEFAULT_INDEX'] === TSINGHUA) {
          // The user changes install settings while the first attempt fails.
          mockInstallPreferences({ ...DEFAULT_INSTALL_PREFERENCES, githubMirror: 'https://ghproxy.test' })
          invalidate()
        }
        return runMise(bin, args, opts)
      })

      await expect(installBabeldoc(service)).resolves.toBe('0.6.4')

      expect(attemptedIndexes()).toEqual([TSINGHUA, TENCENT])
      const useCalls = mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')
      expect(useCalls[1][2].env['MISE_URL_REPLACEMENTS']).toBeUndefined()
    })
  })

  describe('state mutex concurrency', () => {
    it('serializes concurrent installByName calls', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }

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
        if (args[0] === 'ls' && args.length === 2) return { stdout: '{}', stderr: '' }
        if (args[0] === 'ls') {
          const toolKey = args[2]
          const version = toolKey === 'fd' ? '10.0.0' : '15.0.0'
          return { stdout: JSON.stringify({ [toolKey]: [{ version, active: true }] }), stderr: '' }
        }
        if (args[0] === 'which') {
          return { stdout: `/mock/mise/shims/${args[1]}\n`, stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const p1 = service.installByName({ name: 'fd' })
      const p2 = service.installByName({ name: 'rg' })

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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      let releaseInstall!: () => void
      const installStarted = new Promise<void>((resolve) => {
        releaseInstall = resolve
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') await installStarted
        if (args[0] === 'ls' && args.length === 2) return { stdout: '{}', stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      // installByName dedupes by target version, so two name-only installs coalesce.
      const first = service.installByName({ name: 'fd' })
      const second = service.installByName({ name: 'fd' })
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      releaseInstall()

      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
      expect(mockExecFileAsync.mock.calls.filter((call: any[]) => call[1][0] === 'use')).toHaveLength(1)
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('rejects a remove while the same tool install is queued without replacing its operation', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      const release = await (service as any).mutationMutex.acquire()
      const install = service.installByName({ name: 'fd' })

      await expect(service.removeTool({ name: 'fd' })).rejects.toThrow('already installing')
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })

      release()
      await expect(install).rejects.toThrow()
    })

    it('rejects an install while the same tool removal is queued without replacing its operation', async () => {
      const service = new BinaryManager()
      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      const release = await (service as any).mutationMutex.acquire()
      const removal = service.removeTool({ name: 'fd' })

      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('already removing')
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'removing' }
      })

      release()
      // With no backend the cleanup cannot be verified, so the remove fails closed
      // to a typed cleanup_blocked (nothing removed) and clears its removing op.
      await expect(removal).resolves.toEqual({
        status: 'cleanup_blocked',
        reason: 'backend_unavailable',
        message: expect.stringContaining('fd')
      })
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('rejects a second same-name install with a different target without changing the in-flight state', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      let releaseInstall!: () => void
      const installStarted = new Promise<void>((resolve) => {
        releaseInstall = resolve
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') await installStarted
        if (args[0] === 'ls' && args.length === 2) return { stdout: '{}', stderr: '' }
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ fd: [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: '/mock/mise/shims/fd\n', stderr: '' }
        return { stdout: '', stderr: '' }
      })

      const first = service.installByName({ name: 'fd' })
      await expect(service.installByName({ name: 'fd', targetVersion: '2.0.0' })).rejects.toThrow('already installing')
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      releaseInstall()
      await expect(first).resolves.toBeUndefined()
    })
  })

  describe('install state tracking', () => {
    const mockSuccessfulInstall = (toolKey: string, binaryName: string) => {
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ [toolKey]: [{ version: '1.0.0', active: true }] }), stderr: '' }
        if (args[0] === 'which') return { stdout: `/mock/mise/shims/${binaryName}\n`, stderr: '' }
        return { stdout: '', stderr: '' }
      })
    }

    it('publishes installing to main internal cache without mirroring it, then clears on success', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockSuccessfulInstall('fd', 'fd')

      const pending = service.installByName({ name: 'fd' })
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: { status: 'installing' }
      })
      expect(application.get('CacheService').setShared).not.toHaveBeenCalledWith(
        'feature.binary.install_states',
        expect.anything()
      )
      await pending

      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('keeps a failed entry with the error message until retried', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: '{}', stderr: '' }
        if (args[0] === 'use') throw new Error('mise use timed out after 900s')
        return { stdout: '', stderr: '' }
      })

      // installByName's failed operation carries no intent — just action + error.
      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('timed out')
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: {
          status: 'failed',
          action: 'install',
          error: expect.stringContaining('timed out')
        }
      })

      // A retry replaces failed with installing before the mutex work starts.
      mockSuccessfulInstall('fd', 'fd')
      await service.installByName({ name: 'fd' })
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })

    it('publishes a failed entry when the mise backend is unavailable', async () => {
      const service = new BinaryManager()

      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('Binary backend not available')
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({
        fd: {
          status: 'failed',
          action: 'install',
          error: 'Binary backend not available'
        }
      })
    })

    it('does not track state for a request rejected by validation', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      await expect(service.installByName({ name: 'fd', targetVersion: 'bad version' })).rejects.toThrow(
        'Invalid tool version'
      )
      // Validation rejects before any state is published — the cache key is never written.
      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toBeUndefined()
    })

    it('removeTool clears a lingering failed entry', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls') return { stdout: '{}', stderr: '' }
        if (args[0] === 'use') throw new Error('boom')
        return { stdout: '', stderr: '' }
      })
      await expect(service.installByName({ name: 'fd' })).rejects.toThrow('boom')

      manifestRef.value = [{ name: 'fd', tool: 'fd' }]
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })
      await expect(service.removeTool({ name: 'fd' })).resolves.toEqual({ status: 'removed' })

      expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toEqual({})
    })
  })

  describe('runMise env/cwd contract', () => {
    it('passes isolated env and cwd to execFileAsync, not process.env', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const isolatedEnv = { MISE_DATA_DIR: '/isolated', PATH: '/isolated/shims' }
      ;(service as any).isolatedEnv = { env: isolatedEnv, usesDefaultChinaPipIndex: false }

      mockExecFileAsync.mockResolvedValueOnce({ stdout: 'ok\n', stderr: '' })

      await (service as any).runMise(['which', 'fd'])

      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['which', 'fd'], {
        cwd: '/tmp',
        env: isolatedEnv,
        timeout: 120_000
      })
    })

    it('keeps prerelease and npm shell-out environment controls independent', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: { MISE_DATA_DIR: '/isolated' }, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      await (service as any).runMise(['latest', 'npm:prerelease-tool'], { includePrerelease: true })
      await (service as any).runMise(['latest', 'npm:shell-out-tool'], { shellOutNpm: true })

      const prereleaseEnv = mockExecFileAsync.mock.calls[0][2].env
      const shellOutEnv = mockExecFileAsync.mock.calls[1][2].env
      expect(prereleaseEnv).toMatchObject({ MISE_DATA_DIR: '/isolated', MISE_PRERELEASES: '1' })
      expect(prereleaseEnv).not.toHaveProperty('MISE_NPM_SHELL_OUT')
      expect(shellOutEnv).toMatchObject({
        MISE_DATA_DIR: '/isolated',
        MISE_NPM_SHELL_OUT: '1',
        MISE_NPM_PACKAGE_MANAGER: 'npm'
      })
      expect(shellOutEnv).not.toHaveProperty('MISE_PRERELEASES')
    })

    it('prepends a managed runtime without leaving a competing Windows PATH casing', async () => {
      platformMock.isWin = true
      const service = new BinaryManager()
      ;(service as any).miseBin = 'C:\\Cherry\\mise.exe'
      ;(service as any).isolatedEnv = {
        env: { Path: 'C:\\Cherry\\shims;C:\\Windows' },
        usesDefaultChinaPipIndex: false
      }
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      await (service as any).runMise(['registry'], { prependPath: 'C:\\Cherry\\node\\bin' })

      const env = mockExecFileAsync.mock.calls[0][2].env
      expect(env.Path).toBe('C:\\Cherry\\node\\bin;C:\\Cherry\\shims;C:\\Windows')
      expect(env).not.toHaveProperty('PATH')
    })

    it('includes mise stderr in the thrown diagnostic', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockRejectedValueOnce(
        Object.assign(new Error('Command failed'), { stderr: 'network timeout\n' })
      )

      await expect((service as any).runMise(['use', '-g', 'fd'])).rejects.toThrow('Command failed\nnetwork timeout')
    })

    it('does not append stderr when the command error already includes it', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
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
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
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

  describe('Agent CLI inventory', () => {
    it('aggregates bundled, fixed, custom, and runtime tools without `mise which` or exposed paths', async () => {
      manifestRef.value = [{ name: 'acme', tool: 'npm:acme', requestedVersion: '1.2.3' }]
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          'npm:acme': [{ version: '1.2.3', active: true }],
          'core:node': [{ version: '22.1.0', active: true }]
        }),
        stderr: ''
      })
      ;(mockFsp.readdir as any).mockImplementation(async (directory: string) =>
        directory === '/mock/feature.binary.data/shims'
          ? [
              { name: 'acme', isFile: () => true, isSymbolicLink: () => false },
              { name: 'node', isFile: () => true, isSymbolicLink: () => false }
            ]
          : []
      )
      ;(mockFs.existsSync as any).mockImplementation((candidate: string) => candidate === '/mock/cherry.bin/bun')
      mockFs.readFileSync.mockImplementation((candidate: string) =>
        candidate === '/mock/cherry.bin/.bun-version'
          ? '1.3.0'
          : (() => {
              throw new Error('ENOENT')
            })()
      )

      const inventory = await service.getToolInventory()

      expect(inventory).toEqual(
        expect.arrayContaining([
          { name: 'bun', recipe: 'bun', status: 'ready', version: '1.3.0' },
          expect.objectContaining({ name: 'fd', status: 'not_installed' }),
          { name: 'acme', recipe: 'npm:acme', status: 'ready', version: '1.2.3' },
          { name: 'node', recipe: 'core:node', status: 'ready', version: '22.1.0' }
        ])
      )
      expect(JSON.stringify(inventory)).not.toContain('/mock/')
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1)
      expect(mockExecFileAsync.mock.calls[0][1]).toEqual(['ls', '--json'])
    })

    it('reports a recipe with no eponymous bin as ready through the shims it exposes', async () => {
      manifestRef.value = [{ name: 'rust', tool: 'core:rust' }]
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ rust: [{ version: '1.98.0', active: true }] }), stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: '/mock/cargo/bin/cargo' }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => [
        { name: 'cargo', isFile: () => true, isSymbolicLink: () => false },
        { name: 'rustc', isFile: () => true, isSymbolicLink: () => false }
      ])

      await expect(service.getToolInventory()).resolves.toContainEqual({
        name: 'rust',
        recipe: 'core:rust',
        status: 'ready',
        version: '1.98.0'
      })
    })

    it('does not report ready when the exposed shim is not executable', async () => {
      manifestRef.value = [{ name: 'rust', tool: 'core:rust' }]
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'ls')
          return { stdout: JSON.stringify({ rust: [{ version: '1.98.0', active: true }] }), stderr: '' }
        if (args[0] === 'bin-paths') {
          return { stdout: JSON.stringify([{ name: 'cargo', path: '/mock/cargo/bin/cargo' }]), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
      ;(mockFsp.readdir as any).mockImplementation(async () => [
        { name: 'cargo', isFile: () => true, isSymbolicLink: () => false }
      ])
      ;(mockFsp.access as any).mockImplementation(async (candidate: string, mode: number) => {
        if (candidate === '/mock/feature.binary.data/shims/cargo' && mode === mockFs.constants.X_OK) {
          throw new Error('EACCES')
        }
      })

      await expect(service.getToolInventory()).resolves.toContainEqual(
        expect.objectContaining({ name: 'rust', status: 'failed' })
      )
    })

    it('reads live state on every inventory call instead of caching snapshots', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
      mockExecFileAsync.mockResolvedValue({ stdout: '{}', stderr: '' })

      await service.getToolInventory()
      await service.getToolInventory()

      expect(mockExecFileAsync).toHaveBeenCalledTimes(2)
      expect(mockExecFileAsync.mock.calls.every((call: any[]) => call[1][0] === 'ls')).toBe(true)
    })
  })

  describe('extractBundledBinaries', () => {
    let mockFsp: Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>

    beforeEach(async () => {
      const fspModule = await import('node:fs/promises')
      mockFsp = fspModule.default as unknown as Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>
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

    it('restores mise-shim.exe on Windows when mise.exe and its version marker already exist', async () => {
      platformMock.isWin = true
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
      const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!
      Object.defineProperties(process, {
        platform: { value: 'win32' },
        arch: { value: 'x64' }
      })

      try {
        const service = new BinaryManager()

        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p.includes('.mise-version')) return '2026.7.14'
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        })
        mockFs.existsSync.mockImplementation((...args: unknown[]) => {
          const p = String(args[0])
          if (p.includes('app.root.resources.binaries/win32-x64/mise')) return true
          return p.endsWith('cherry.bin/mise.exe')
        })

        await (service as any).extractBundledBinaries()

        expect(mockFsp.copyFile).toHaveBeenCalledWith(
          expect.stringContaining('app.root.resources.binaries/win32-x64/mise.exe'),
          expect.stringContaining('cherry.bin/mise.exe.tmp-')
        )
        expect(mockFsp.copyFile).toHaveBeenCalledWith(
          expect.stringContaining('app.root.resources.binaries/win32-x64/mise-shim.exe'),
          expect.stringContaining('cherry.bin/mise-shim.exe.tmp-')
        )
      } finally {
        Object.defineProperties(process, { platform: originalPlatform, arch: originalArch })
      }
    })
  })
})
