import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { nodeProxyConfigureMock, sessionSetProxyMock, webviewSetProxyMock, appSetProxyMock, getSystemProxyMock } =
  vi.hoisted(() => ({
    nodeProxyConfigureMock: vi.fn(),
    sessionSetProxyMock: vi.fn().mockResolvedValue(undefined),
    webviewSetProxyMock: vi.fn().mockResolvedValue(undefined),
    appSetProxyMock: vi.fn().mockResolvedValue(undefined),
    getSystemProxyMock: vi.fn()
  }))

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
    protected registerInterval() {
      const disposable = { dispose: vi.fn() }
      this._disposables.push(disposable)
      return disposable
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

vi.mock('../proxy/nodeProxy', () => ({
  NodeProxyController: vi.fn(() => ({ configure: nodeProxyConfigureMock }))
}))

vi.mock('os-proxy-config', () => ({ getSystemProxy: getSystemProxyMock }))

vi.mock('electron', () => ({
  app: { setProxy: appSetProxyMock },
  session: {
    defaultSession: { setProxy: sessionSetProxyMock },
    fromPartition: vi.fn(() => ({ setProxy: webviewSetProxyMock }))
  }
}))

const { ProxyManager, resolveProxyConfig } = await import('../ProxyManager')

describe('resolveProxyConfig', () => {
  it('maps none → direct', () => {
    expect(resolveProxyConfig('none', 'http://ignored:1', 'ignored')).toEqual({ mode: 'direct' })
  })

  it('maps system → system (configureProxy resolves the OS proxy)', () => {
    expect(resolveProxyConfig('system', '', '')).toEqual({ mode: 'system' })
  })

  it('maps custom + url → fixed_servers with bypass rules', () => {
    expect(resolveProxyConfig('custom', 'http://127.0.0.1:7890', '*.local')).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '*.local'
    })
  })

  it('maps custom + empty bypass → undefined bypass', () => {
    expect(resolveProxyConfig('custom', 'http://127.0.0.1:7890', '')).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: undefined
    })
  })

  it('falls back custom without url → direct', () => {
    expect(resolveProxyConfig('custom', '', '')).toEqual({ mode: 'direct' })
  })
})

describe('ProxyManager — preference wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    getSystemProxyMock.mockResolvedValue({ proxyUrl: 'http://system:1080', noProxy: ['localhost'] })
  })

  it('applies the custom proxy from preferences on ready (Node stack + Electron sessions)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'custom')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://127.0.0.1:7890')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.bypass_rules', 'localhost')

    const manager = new ProxyManager()
    await (manager as any).onReady()

    expect(nodeProxyConfigureMock).toHaveBeenCalledWith({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'localhost'
    })
    const expected = { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost' }
    expect(sessionSetProxyMock).toHaveBeenCalledWith(expected)
    expect(webviewSetProxyMock).toHaveBeenCalledWith(expected)
    expect(appSetProxyMock).toHaveBeenCalledWith(expected)
  })

  it('re-applies when a proxy preference changes after ready', async () => {
    // Default mode is 'system'.
    const manager = new ProxyManager()
    await (manager as any).onReady()
    nodeProxyConfigureMock.mockClear()

    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.mode', 'none')

    // The subscriber kicks off an un-awaited async re-apply; wait for it to settle.
    await vi.waitFor(() =>
      expect(nodeProxyConfigureMock).toHaveBeenCalledWith({ proxyRules: undefined, proxyBypassRules: undefined })
    )
    expect(sessionSetProxyMock).toHaveBeenLastCalledWith({ mode: 'direct' })
  })
})
