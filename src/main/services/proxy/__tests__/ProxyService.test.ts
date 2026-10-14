import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  nodeProxyConfigureMock,
  nodeProxyControllerConstructorMock,
  sessionSetProxyMock,
  webviewSetProxyMock,
  appSetProxyMock,
  sessionFromPartitionMock,
  getSystemProxyMock,
  intervalRegistrations
} = vi.hoisted(() => {
  const nodeProxyConfigureMock = vi.fn()
  const webviewSetProxyMock = vi.fn().mockResolvedValue(undefined)

  return {
    nodeProxyConfigureMock,
    nodeProxyControllerConstructorMock: vi.fn(function NodeProxyControllerMock() {
      return { configure: nodeProxyConfigureMock }
    }),
    sessionSetProxyMock: vi.fn().mockResolvedValue(undefined),
    webviewSetProxyMock,
    appSetProxyMock: vi.fn().mockResolvedValue(undefined),
    sessionFromPartitionMock: vi.fn(() => ({ setProxy: webviewSetProxyMock })),
    getSystemProxyMock: vi.fn(),
    intervalRegistrations: [] as Array<{ handler: () => void; dispose: ReturnType<typeof vi.fn> }>
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(disposable: T): T {
      this._disposables.push(disposable)
      return disposable
    }
    protected registerInterval(handler: () => void) {
      const dispose = vi.fn()
      intervalRegistrations.push({ handler, dispose })
      this._disposables.push({ dispose })
      return { dispose }
    }
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

vi.mock('../NodeProxyController', () => ({
  NodeProxyController: nodeProxyControllerConstructorMock
}))

vi.mock('os-proxy-config', () => ({ getSystemProxy: getSystemProxyMock }))

vi.mock('electron', () => ({
  app: { setProxy: appSetProxyMock },
  session: {
    defaultSession: { setProxy: sessionSetProxyMock },
    fromPartition: sessionFromPartitionMock
  }
}))

const { ProxyService, resolveProxyConfig } = await import('../ProxyService')

const reconcilerOf = (manager: unknown) =>
  (manager as { proxyReconciler: { flush: () => Promise<void> } }).proxyReconciler

describe('resolveProxyConfig', () => {
  it('maps none → direct', () => {
    expect(resolveProxyConfig({ mode: 'none', url: 'http://ignored:1', bypassRules: 'ignored' })).toEqual({
      mode: 'direct'
    })
  })

  it('maps system → system (OS proxy resolved later in snapshotProxyConfig)', () => {
    expect(resolveProxyConfig({ mode: 'system', url: '', bypassRules: '' })).toEqual({ mode: 'system' })
  })

  it('maps custom + url → fixed_servers with bypass rules', () => {
    expect(resolveProxyConfig({ mode: 'custom', url: 'http://127.0.0.1:7890', bypassRules: '*.local' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '*.local'
    })
  })

  it('maps custom + empty bypass → undefined bypass', () => {
    expect(resolveProxyConfig({ mode: 'custom', url: 'http://127.0.0.1:7890', bypassRules: '' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: undefined
    })
  })

  it('falls back custom without url → direct', () => {
    expect(resolveProxyConfig({ mode: 'custom', url: '', bypassRules: '' })).toEqual({ mode: 'direct' })
  })
})

describe('ProxyService — preference wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodeProxyConfigureMock.mockReset().mockResolvedValue(undefined)
    sessionSetProxyMock.mockReset().mockResolvedValue(undefined)
    webviewSetProxyMock.mockReset().mockResolvedValue(undefined)
    appSetProxyMock.mockReset().mockResolvedValue(undefined)
    MockMainPreferenceServiceUtils.resetMocks()
    intervalRegistrations.length = 0
    getSystemProxyMock.mockResolvedValue({ proxyUrl: 'http://system:1080', noProxy: ['localhost'] })
  })

  it('defers Node proxy controller construction until proxy apply', async () => {
    const manager = new ProxyService()
    expect(nodeProxyControllerConstructorMock).not.toHaveBeenCalled()

    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    expect(nodeProxyControllerConstructorMock).toHaveBeenCalledTimes(1)
  })

  it('applies the custom proxy from preferences on ready (Node stack + Electron sessions)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://127.0.0.1:7890')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.bypass_rules', 'localhost')

    const manager = new ProxyService()
    await (manager as any).onReady()
    // onReady no longer blocks on the initial apply; await convergence before asserting.
    await reconcilerOf(manager).flush()

    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'localhost'
    })
    const expected = { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost' }
    expect(sessionSetProxyMock).toHaveBeenCalledWith(expected)
    expect(webviewSetProxyMock).toHaveBeenCalledWith(expected)
    expect(sessionFromPartitionMock).toHaveBeenCalledWith('agent-dev-preview')
    expect(sessionFromPartitionMock).toHaveBeenCalledWith('agent-html-artifact')
    expect(appSetProxyMock).toHaveBeenCalledWith(expected)
  })

  it('applies the resolved system proxy on ready to every stack', async () => {
    // Default mode is 'system'; getSystemProxy returns a known proxy (set in beforeEach).
    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    const expected = { mode: 'system', proxyRules: 'http://system:1080', proxyBypassRules: 'localhost' }
    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({
      proxyRules: 'http://system:1080',
      proxyBypassRules: 'localhost'
    })
    expect(sessionSetProxyMock).toHaveBeenCalledWith(expected)
    expect(webviewSetProxyMock).toHaveBeenCalledWith(expected)
    expect(appSetProxyMock).toHaveBeenCalledWith(expected)
  })

  it('applies bare system mode when the OS proxy is unavailable', async () => {
    getSystemProxyMock.mockResolvedValue(null)
    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    expect(sessionSetProxyMock).toHaveBeenCalledWith({ mode: 'system' })
    expect(appSetProxyMock).toHaveBeenCalledWith({ mode: 'system' })
    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({ proxyRules: undefined, proxyBypassRules: undefined })
  })

  it('re-applies when a proxy preference changes after ready', async () => {
    // Default mode is 'system'.
    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()
    nodeProxyConfigureMock.mockClear()

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'none')

    // The subscriber kicks off an un-awaited async re-apply; wait for it to settle.
    await vi.waitFor(() =>
      expect(nodeProxyConfigureMock).toHaveBeenCalledWith({ proxyRules: undefined, proxyBypassRules: undefined })
    )
    expect(sessionSetProxyMock).toHaveBeenLastCalledWith({ mode: 'direct' })
  })

  it('coalesces to the latest change when one lands while an apply is in flight', async () => {
    // Block the first apply mid-flight so a newer change arrives before it finishes.
    let releaseFirstApply!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirstApply = resolve
    })
    sessionSetProxyMock.mockReturnValueOnce(gate.then(() => undefined))

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://first:1')

    const manager = new ProxyService()
    await (manager as any).onReady()

    // Newer change lands while the first apply is gated.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://second:2')

    releaseFirstApply()
    await reconcilerOf(manager).flush()

    // Latest wins: the final applied config targets the second URL (not dropped).
    expect(sessionSetProxyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'fixed_servers', proxyRules: 'http://second:2' })
    )
  })

  it('reports an apply that threw as unconverged with the reason, until a later apply succeeds', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', '127.0.0.1:7890')
    nodeProxyConfigureMock.mockRejectedValueOnce(new TypeError('Invalid URL'))
    const manager = new ProxyService()
    await (manager as any).onReady()

    await expect(manager.getAppliedSnapshot()).resolves.toEqual({
      mode: 'custom',
      hasConfiguredUrl: true,
      systemProxyReadFailed: false,
      converged: false,
      lastError: 'Invalid URL'
    })

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://127.0.0.1:7890')
    await expect(manager.getAppliedSnapshot()).resolves.toMatchObject({ converged: true })
    await expect(manager.getAppliedSnapshot()).resolves.not.toHaveProperty('lastError')
  })

  it('re-applies the previous config after a partially failed proxy change', async () => {
    let nodeRoute: string | undefined
    nodeProxyConfigureMock.mockImplementation(async (config) => {
      nodeRoute = config.proxyRules
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://first:1')
    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    sessionSetProxyMock.mockRejectedValueOnce(new Error('Session proxy failed'))
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://second:2')
    const failed = await manager.getAppliedSnapshot()
    const failedKey = manager.appliedProxyKey
    expect(nodeRoute).toBe('http://second:2')

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://first:1')
    await expect(manager.getAppliedSnapshot()).resolves.toMatchObject({ converged: true })
    expect(nodeRoute).toBe('http://first:1')
    expect(failed).toMatchObject({ converged: false, lastError: 'Session proxy failed' })
    expect(failedKey).toBeNull()
  })

  it('drains failed session batches before applying newer preferences', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let appRoute: string | undefined
    appSetProxyMock.mockImplementation(async (config) => {
      if (config.proxyRules === 'http://first:1') await gate
      appRoute = config.proxyRules
    })
    sessionSetProxyMock.mockRejectedValueOnce(new Error('Session proxy failed'))
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://first:1')
    const manager = new ProxyService()
    await (manager as any).onReady()
    await vi.waitFor(() => expect(appSetProxyMock).toHaveBeenCalled())

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://second:2')
    let settled = false
    const snapshot = manager.getAppliedSnapshot().then((result) => {
      settled = true
      return result
    })
    // Let a premature fail-fast batch drain its microtasks before releasing the old write.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const settledBeforeRelease = settled
    release()
    await expect(snapshot).resolves.toMatchObject({ converged: true })
    expect(appRoute).toBe('http://second:2')
    expect(settledBeforeRelease).toBe(false)
  })

  it('flags a failed OS proxy read while still converging on bare system mode', async () => {
    getSystemProxyMock.mockRejectedValue(new Error('scutil exited with 1'))
    const manager = new ProxyService()
    await (manager as any).onReady()

    await expect(manager.getAppliedSnapshot()).resolves.toMatchObject({
      mode: 'system',
      systemProxyReadFailed: true,
      converged: true
    })
    expect(sessionSetProxyMock).toHaveBeenCalledWith({ mode: 'system' })
  })

  it('manages the system-proxy monitor across mode switches', async () => {
    const manager = new ProxyService()
    const reconciler = reconcilerOf(manager)
    await (manager as any).onReady()
    await reconciler.flush()

    // System apply starts exactly one monitor interval.
    expect(intervalRegistrations).toHaveLength(1)
    const monitor = intervalRegistrations[0]
    expect(monitor.dispose).not.toHaveBeenCalled()

    // An OS-proxy change via the monitor tick re-applies but does NOT re-register the interval.
    getSystemProxyMock.mockResolvedValue({ proxyUrl: 'http://system2:2', noProxy: [] })
    monitor.handler()
    await reconciler.flush()
    expect(sessionSetProxyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'system', proxyRules: 'http://system2:2' })
    )
    expect(intervalRegistrations).toHaveLength(1)

    // An unchanged OS read is a no-op (appliedKey/isSettled suppresses the apply).
    sessionSetProxyMock.mockClear()
    monitor.handler()
    await reconciler.flush()
    expect(sessionSetProxyMock).not.toHaveBeenCalled()

    // system → custom disposes the monitor (and doesn't start a new one).
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://custom:1')
    await reconciler.flush()
    expect(monitor.dispose).toHaveBeenCalledTimes(1)
    expect(intervalRegistrations).toHaveLength(1)

    // custom → system restarts it.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'system')
    await reconciler.flush()
    expect(intervalRegistrations).toHaveLength(2)
  })
})
