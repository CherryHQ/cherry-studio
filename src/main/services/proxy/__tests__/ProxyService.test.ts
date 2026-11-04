import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProxyBypassRuleMatcher } from '../bypassRules'

const {
  nodeProxyConfigureMock,
  nodeProxyControllerConstructorMock,
  sessionSetProxyMock,
  webviewSetProxyMock,
  proxyTestSetProxyMock,
  proxyTestCloseAllConnectionsMock,
  proxyTestResolveProxyMock,
  proxyTestFetchMock,
  appSetProxyMock,
  sessionFromPartitionMock,
  getSystemProxyMock,
  intervalRegistrations
} = vi.hoisted(() => {
  const nodeProxyConfigureMock = vi.fn()
  const webviewSetProxyMock = vi.fn().mockResolvedValue(undefined)

  const proxyTestSetProxyMock = vi.fn().mockResolvedValue(undefined)

  const proxyTestCloseAllConnectionsMock = vi.fn().mockResolvedValue(undefined)

  const proxyTestResolveProxyMock = vi.fn().mockResolvedValue('PROXY proxy.example:8080')

  const proxyTestFetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })

  return {
    nodeProxyConfigureMock,
    nodeProxyControllerConstructorMock: vi.fn(function NodeProxyControllerMock() {
      return { configure: nodeProxyConfigureMock }
    }),
    sessionSetProxyMock: vi.fn().mockResolvedValue(undefined),
    webviewSetProxyMock,
    proxyTestSetProxyMock,
    proxyTestCloseAllConnectionsMock,
    proxyTestResolveProxyMock,
    proxyTestFetchMock,
    appSetProxyMock: vi.fn().mockResolvedValue(undefined),
    sessionFromPartitionMock: vi.fn((partition: string) =>
      partition === 'proxy-connection-test'
        ? {
            setProxy: proxyTestSetProxyMock,
            closeAllConnections: proxyTestCloseAllConnectionsMock,
            resolveProxy: proxyTestResolveProxyMock,
            fetch: proxyTestFetchMock
          }
        : { setProxy: webviewSetProxyMock }
    ),
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

const { PROXY_TEST_TARGET, ProxyService, resolveProxyConfig } = await import('../ProxyService')

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

  it('maps custom + url → fixed_servers with user bypass rules kept ahead of the loopback scope', () => {
    expect(resolveProxyConfig({ mode: 'custom', url: 'http://127.0.0.1:7890', bypassRules: '*.local' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules:
        '*.local,localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    })
  })

  it('maps custom + empty bypass → loopback scope (#20920)', () => {
    expect(resolveProxyConfig({ mode: 'custom', url: 'http://127.0.0.1:7890', bypassRules: '' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules:
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    })
  })

  it('dedupes loopback entries case-insensitively across separators', () => {
    expect(
      resolveProxyConfig({
        mode: 'custom',
        url: 'http://proxy.lan:7890',
        bypassRules: 'LOCALHOST, corp.local ; 127.0.0.1, [::1]'
      })?.proxyBypassRules
    ).toBe(
      'LOCALHOST,corp.local,127.0.0.1,[::1],*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    )
  })

  it('honors a bare * as already covering loopback', () => {
    expect(
      resolveProxyConfig({ mode: 'custom', url: 'http://proxy.lan:7890', bypassRules: '*' })?.proxyBypassRules
    ).toBe('*')
  })

  it('honors <-loopback> as an explicit opt-in to proxy loopback', () => {
    expect(
      resolveProxyConfig({ mode: 'custom', url: 'http://proxy.lan:7890', bypassRules: '*.local,<-loopback>' })
        ?.proxyBypassRules
    ).toBe('*.local,<-loopback>')
  })

  it('honors the negation case-insensitively and keeps the user spelling verbatim', () => {
    expect(
      resolveProxyConfig({ mode: 'custom', url: 'http://proxy.lan:7890', bypassRules: '*.local,<-LoopBack>' })
        ?.proxyBypassRules
    ).toBe('*.local,<-LoopBack>')
  })

  it('merges a loopback scope the Node matcher actually honors for every covered host form', () => {
    const merged = resolveProxyConfig({
      mode: 'custom',
      url: 'http://proxy.lan:7890',
      bypassRules: ''
    })?.proxyBypassRules
    expect(merged).toBeDefined()
    const matcher = new ProxyBypassRuleMatcher()
    matcher.updateByPassRules(merged!.split(','))

    // Every form the implicit scope covers must bypass through the merged rules — this runs the
    // real string through the real matcher, so a defaults entry the matcher cannot parse fails here.
    for (const url of [
      'http://localhost:8001/',
      'http://localhost.:8001/',
      'http://foo.localhost:8001/',
      'http://localhost6:8001/',
      'http://loopback:8001/',
      'http://loopback.:8001/',
      'http://127.0.0.1:8001/',
      'http://127.0.0.1.:8001/',
      'http://127.0.0.4:8001/',
      'http://0.0.0.0:8001/',
      'http://[::1]:8001/',
      'http://[0:0:0:0:0:0:0:1]:8001/',
      'http://[::ffff:127.0.0.1]:8001/',
      'http://[::ffff:7f00:9]:8001/',
      'http://169.254.3.4:8001/',
      'http://[fe80::1]:8001/'
    ]) {
      expect(matcher.isByPass(url), url).toBe(true)
    }
    expect(matcher.isByPass('http://example.com:8001/')).toBe(false)
    expect(matcher.isByPass('http://[::ffff:8.8.8.8]:8001/')).toBe(false)
    // the merged string is shared with Chromium, whose bypass syntax has no brackets
    // around IPv6 CIDRs — keep every entry parseable on both stacks
    expect(merged!.split(',').every((entry) => !/^\[.*\]\/\d+$/.test(entry))).toBe(true)
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
    proxyTestSetProxyMock.mockResolvedValue(undefined)
    proxyTestCloseAllConnectionsMock.mockResolvedValue(undefined)
    proxyTestResolveProxyMock.mockResolvedValue('PROXY proxy.example:8080')
    proxyTestFetchMock.mockResolvedValue({ ok: true, status: 204 })
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
      proxyBypassRules:
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    })
    const expected = {
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules:
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    }
    expect(sessionSetProxyMock).toHaveBeenCalledWith(expected)
    expect(webviewSetProxyMock).toHaveBeenCalledWith(expected)
    expect(sessionFromPartitionMock).toHaveBeenCalledWith('agent-dev-preview')
    expect(sessionFromPartitionMock).toHaveBeenCalledWith('agent-html-artifact')
    expect(appSetProxyMock).toHaveBeenCalledWith(expected)
  })

  it('passes <-loopback> verbatim to both stacks (the Node controller consumes the directive)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://proxy.lan:7890')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.bypass_rules', '*.local,<-loopback>')

    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    expect(sessionSetProxyMock).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.lan:7890',
      proxyBypassRules: '*.local,<-loopback>'
    })
    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({
      proxyRules: 'http://proxy.lan:7890',
      proxyBypassRules: '*.local,<-loopback>'
    })
  })

  it('bypasses loopback for local MCP-style targets even when the user sets no bypass rules', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://proxy.lan:7890')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.bypass_rules', '')

    const manager = new ProxyService()
    await (manager as any).onReady()
    await reconcilerOf(manager).flush()

    const expected = {
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.lan:7890',
      proxyBypassRules:
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    }
    expect(sessionSetProxyMock).toHaveBeenCalledWith(expected)
    expect(appSetProxyMock).toHaveBeenCalledWith(expected)
    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({
      proxyRules: 'http://proxy.lan:7890',
      proxyBypassRules:
        'localhost,*.localhost,localhost6,localhost6.localdomain6,loopback,127.0.0.0/8,0.0.0.0,[::1],::ffff:127.0.0.0/104,169.254.0.0/16,fe80::/10'
    })
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

describe('ProxyService — connection test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    proxyTestSetProxyMock.mockResolvedValue(undefined)
    proxyTestCloseAllConnectionsMock.mockResolvedValue(undefined)
    proxyTestResolveProxyMock.mockResolvedValue('PROXY proxy.example:8080')
    proxyTestFetchMock.mockResolvedValue({ ok: true, status: 204 })
  })

  it.each([
    'PROXY 127.0.0.1:1; DIRECT',
    'DIRECT;PROXY 127.0.0.1:1',
    '  proxy proxy.example:8080 ; direct  ',
    'PROXY proxy-one.example:8080; SOCKS5 proxy-two.example:1080; DIRECT'
  ])('does not certify proxy use when PAC permits direct fallback: %s', async (candidates) => {
    proxyTestResolveProxyMock.mockResolvedValue(candidates)

    await expect(new ProxyService().testConnection({ mode: 'system', url: '', bypassRules: '' })).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'fallback',
      success: true
    })
  })

  it('preserves a direct-only system PAC route', async () => {
    proxyTestResolveProxyMock.mockResolvedValue('DIRECT')
    await expect(new ProxyService().testConnection({ mode: 'system', url: '', bypassRules: '' })).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'direct',
      success: true
    })
  })

  it('preserves a proxy-only PAC candidate list', async () => {
    proxyTestResolveProxyMock.mockResolvedValue('PROXY first.example:8080; SOCKS5 second.example:1080')
    await expect(new ProxyService().testConnection({ mode: 'system', url: '', bypassRules: '' })).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: true
    })
  })

  it('tests an edited custom proxy without applying it to the global sessions', async () => {
    const manager = new ProxyService()

    await expect(
      manager.testConnection({ mode: 'custom', url: 'http://proxy.example:8080', bypassRules: 'draft-only.example' })
    ).resolves.toEqual({ target: PROXY_TEST_TARGET, route: 'proxy', success: true })

    expect(proxyTestSetProxyMock).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.example:8080',
      proxyBypassRules: expect.stringContaining('draft-only.example')
    })
    expect(proxyTestCloseAllConnectionsMock).toHaveBeenCalledOnce()
    expect(proxyTestSetProxyMock.mock.invocationCallOrder[0]).toBeLessThan(
      proxyTestCloseAllConnectionsMock.mock.invocationCallOrder[0]
    )
    expect(proxyTestCloseAllConnectionsMock.mock.invocationCallOrder[0]).toBeLessThan(
      proxyTestFetchMock.mock.invocationCallOrder[0]
    )
    expect(proxyTestFetchMock).toHaveBeenCalledWith(
      PROXY_TEST_TARGET,
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(sessionSetProxyMock).not.toHaveBeenCalled()
    expect(appSetProxyMock).not.toHaveBeenCalled()
  })

  it('does not reuse a pooled connection after switching between HTTP and SOCKS proxies', async () => {
    let configuredProxy = ''
    let pooledProxy = ''
    proxyTestSetProxyMock.mockImplementation(async (config) => {
      configuredProxy = config.proxyRules ?? ''
    })
    proxyTestCloseAllConnectionsMock.mockImplementation(async () => {
      pooledProxy = ''
    })
    proxyTestFetchMock.mockImplementation(async () => {
      pooledProxy ||= configuredProxy
      if (pooledProxy === 'socks5://proxy-two.example:1080') {
        throw new Error('net::ERR_PROXY_CONNECTION_FAILED')
      }
      return { ok: true, status: 204 }
    })

    const manager = new ProxyService()
    await expect(
      manager.testConnection({ mode: 'custom', url: 'http://proxy-one.example:8080', bypassRules: '' })
    ).resolves.toEqual({ target: PROXY_TEST_TARGET, route: 'proxy', success: true })
    await expect(
      manager.testConnection({ mode: 'custom', url: 'socks5://proxy-two.example:1080', bypassRules: '' })
    ).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: false,
      error: 'unreachable'
    })

    expect(proxyTestCloseAllConnectionsMock).toHaveBeenCalledTimes(2)
  })

  it('reports when the configured bypass rules select a direct route', async () => {
    proxyTestResolveProxyMock.mockResolvedValue('DIRECT')

    await expect(
      new ProxyService().testConnection({
        mode: 'custom',
        url: 'socks5://127.0.0.1:1080',
        bypassRules: 'www.gstatic.com'
      })
    ).resolves.toEqual({ target: PROXY_TEST_TARGET, route: 'bypassed', success: true })
  })

  it('returns a distinct validation result for an empty or malformed custom proxy', async () => {
    const manager = new ProxyService()

    await expect(manager.testConnection({ mode: 'custom', url: '', bypassRules: '' })).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: false,
      error: 'invalid_config'
    })
    await expect(manager.testConnection({ mode: 'custom', url: 'not-a-url', bypassRules: '' })).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: false,
      error: 'invalid_config'
    })
    expect(proxyTestSetProxyMock).not.toHaveBeenCalled()
  })

  it('classifies proxy authentication failures without returning credentials or raw errors', async () => {
    proxyTestFetchMock.mockRejectedValue(
      new Error('ERR_PROXY_AUTH_REQUESTED for http://proxy-user:proxy-secret@127.0.0.1:8080')
    )

    const result = await new ProxyService().testConnection({
      mode: 'custom',
      url: 'http://proxy-user:proxy-secret@127.0.0.1:8080',
      bypassRules: ''
    })

    expect(result).toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: false,
      error: 'authentication_required'
    })
    expect(JSON.stringify(result)).not.toContain('proxy-user')
    expect(JSON.stringify(result)).not.toContain('proxy-secret')
    expect(JSON.stringify(result)).not.toContain('127.0.0.1')
  })

  it('classifies unreachable proxies without exposing the rejected error', async () => {
    proxyTestFetchMock.mockRejectedValue(new Error('net::ERR_PROXY_CONNECTION_FAILED at 127.0.0.1:65535'))

    await expect(
      new ProxyService().testConnection({ mode: 'custom', url: 'socks5://127.0.0.1:65535', bypassRules: '' })
    ).resolves.toEqual({
      target: PROXY_TEST_TARGET,
      route: 'proxy',
      success: false,
      error: 'unreachable'
    })
  })
})
