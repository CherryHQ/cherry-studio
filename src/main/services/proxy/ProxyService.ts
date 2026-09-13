import type { ProxyConfig } from 'electron'
import { app, session } from 'electron'
import { getSystemProxy } from 'os-proxy-config'

import { application } from '@application'
import { loggerService } from '@logger'
import { createLatestReconciler } from '@main/core/concurrency/latestReconciler'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProxyMode, UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'

import { NodeProxyController } from './NodeProxyController'
import { normalizeProxyEndpoint } from './proxyRouting'

const logger = loggerService.withContext('ProxyService')

const PROXY_TEST_PARTITION = 'proxy-connection-test'
export const PROXY_TEST_TARGET = 'https://www.gstatic.com/generate_204'
const PROXY_TEST_TIMEOUT_MS = 10_000

export type ProxyConnectionTestResult = {
  target: string
  route: 'proxy' | 'bypassed' | 'direct'
  success: boolean
  error?: 'invalid_config' | 'authentication_required' | 'timeout' | 'unreachable' | 'http_error' | 'connection_failed'
}

function classifyProxyTestError(error: unknown): NonNullable<ProxyConnectionTestResult['error']> {
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : ''
  if (message.includes('proxy_auth') || message.includes('proxy authentication') || message.includes('407')) {
    return 'authentication_required'
  }
  if (message.includes('abort') || message.includes('timeout')) return 'timeout'
  if (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('err_name_not_resolved') ||
    message.includes('err_proxy_connection_failed') ||
    message.includes('err_tunnel_connection_failed')
  ) {
    return 'unreachable'
  }
  return 'connection_failed'
}

/** Proxy preferences that drive the global proxy. Changing any of them re-applies it. */
const PROXY_PREFERENCE_KEYS = [
  'app.proxy.mode',
  'app.proxy.url',
  'app.proxy.bypass_rules'
] as const satisfies readonly UnifiedPreferenceKeyType[]

/** Identity of an applied proxy config, for latest-wins settle detection. */
const proxyConfigKey = (c: Pick<ProxyConfig, 'mode' | 'proxyRules' | 'proxyBypassRules'>): string =>
  `${c.mode}|${c.proxyRules ?? ''}|${c.proxyBypassRules ?? ''}`

/**
 * Map the user-facing proxy mode to an Electron {@link ProxyConfig}. `system` returns the bare
 * `system` mode; the concrete system proxy URL is resolved from the OS later. A `custom` mode
 * without a URL can't form a fixed-servers config, so it falls back to direct.
 */
export function resolveProxyConfig({
  mode,
  url,
  bypassRules
}: {
  mode: ProxyMode
  url: string
  bypassRules: string
}): ProxyConfig {
  switch (mode) {
    case 'none':
      return { mode: 'direct' }
    case 'custom':
      return url
        ? { mode: 'fixed_servers', proxyRules: url, proxyBypassRules: bypassRules || undefined }
        : { mode: 'direct' }
    case 'system':
    default:
      return { mode: 'system' }
  }
}

@Injectable('ProxyService')
@ServicePhase(Phase.WhenReady)
export class ProxyService extends BaseService {
  private systemProxyInterval: Disposable | null = null
  private appliedKey: string | null = null
  private nodeProxyController: NodeProxyController | null = null
  private proxyTestQueue: Promise<void> = Promise.resolve()

  // Latest-wins reconciler: rapid proxy-preference toggles (or system-proxy changes) collapse
  // into a single re-read + re-apply — single-flight and level-triggered, so a change landing
  // mid-apply re-converges instead of being dropped. See #16233.
  private readonly proxyReconciler = createLatestReconciler<ProxyConfig>({
    name: 'proxy',
    getSnapshot: () => this.snapshotProxyConfig(),
    isSettled: (config) => proxyConfigKey(config) === this.appliedKey,
    apply: (config) => this.applyProxyConfig(config)
  })

  /**
   * Key of the currently applied proxy config (null before the first apply).
   * Exposed so RegionService can invalidate its cached egress country the
   * moment the proxy — and thus the egress IP — changes.
   */
  get appliedProxyKey(): string | null {
    return this.appliedKey
  }

  async testConnection({
    mode,
    url,
    bypassRules
  }: {
    mode: ProxyMode
    url: string
    bypassRules: string
  }): Promise<ProxyConnectionTestResult> {
    const run = this.proxyTestQueue.then(() => this.runConnectionTest({ mode, url, bypassRules }))
    this.proxyTestQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async runConnectionTest({
    mode,
    url,
    bypassRules
  }: {
    mode: ProxyMode
    url: string
    bypassRules: string
  }): Promise<ProxyConnectionTestResult> {
    if (mode === 'custom') {
      try {
        if (!url.trim()) throw new Error('Missing proxy URL')
        normalizeProxyEndpoint(url.trim())
      } catch {
        return { target: PROXY_TEST_TARGET, route: 'proxy', success: false, error: 'invalid_config' }
      }
    }

    const config = resolveProxyConfig({ mode, url: url.trim(), bypassRules })
    const testSession = session.fromPartition(PROXY_TEST_PARTITION, { cache: false })
    let route: ProxyConnectionTestResult['route'] = mode === 'none' ? 'direct' : 'proxy'

    try {
      await testSession.setProxy(config)
      await testSession.closeAllConnections()
      const resolvedRoute = await testSession.resolveProxy(PROXY_TEST_TARGET)
      if (resolvedRoute.trim().toUpperCase() === 'DIRECT') {
        route = mode === 'custom' ? 'bypassed' : 'direct'
      }

      const response = await testSession.fetch(PROXY_TEST_TARGET, {
        method: 'GET',
        signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS)
      })
      if (response.status === 407) {
        return { target: PROXY_TEST_TARGET, route, success: false, error: 'authentication_required' }
      }
      if (!response.ok) return { target: PROXY_TEST_TARGET, route, success: false, error: 'http_error' }
      return { target: PROXY_TEST_TARGET, route, success: true }
    } catch (error) {
      return { target: PROXY_TEST_TARGET, route, success: false, error: classifyProxyTestError(error) }
    }
  }

  /**
   * Apply the proxy from user preferences on startup, then re-apply whenever the proxy
   * preferences change. Without this the global proxy mechanism is never wired to settings —
   * changing the proxy in the UI would have no effect on the network stack.
   */
  protected async onReady(): Promise<void> {
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges([...PROXY_PREFERENCE_KEYS], () => this.proxyReconciler.request())
    )
    // Don't gate startup on the initial apply. The OS-proxy read (a `scutil` spawn in system
    // mode) only feeds the Node-side controller, which no startup request hits; Electron sessions
    // already follow the system proxy by Chromium default. Converge in the background instead.
    this.proxyReconciler.request()
    void this.proxyReconciler.flush().then(() => {
      const error = this.proxyReconciler.getLastError()
      if (error) {
        logger.error('Initial proxy apply failed; traffic uses the default route until the next change', error)
      }
    })
  }

  /** Latest intent from preferences, resolving the concrete OS proxy for `system` mode. */
  private async snapshotProxyConfig(): Promise<ProxyConfig> {
    const preferenceService = application.get('PreferenceService')
    const config = resolveProxyConfig({
      mode: preferenceService.get('app.proxy.mode'),
      url: preferenceService.get('app.proxy.url'),
      bypassRules: preferenceService.get('app.proxy.bypass_rules')
    })
    if (config.mode === 'system') {
      // A failed OS read must not abort the apply — fall back to bare system mode so Electron
      // still applies something instead of leaving the proxy unconfigured.
      try {
        const currentProxy = await getSystemProxy()
        if (currentProxy) {
          config.proxyRules = currentProxy.proxyUrl.toLowerCase()
          config.proxyBypassRules = currentProxy.noProxy.join(',')
        }
      } catch (error) {
        logger.warn('Failed to read OS system proxy; applying bare system mode', error as Error)
      }
    }
    return config
  }

  private async applyProxyConfig(config: ProxyConfig): Promise<void> {
    logger.info(`apply proxy: ${config.mode} ${config.proxyRules ?? ''} ${config.proxyBypassRules ?? ''}`)
    // In system mode, poll the OS proxy so external changes re-converge through the reconciler.
    if (config.mode === 'system') this.ensureSystemProxyMonitor()
    else this.clearSystemProxyMonitor()

    await this.setGlobalProxy(config)
    this.appliedKey = proxyConfigKey(config)
  }

  private ensureSystemProxyMonitor(): void {
    if (this.systemProxyInterval) return
    this.systemProxyInterval = this.registerInterval(() => this.proxyReconciler.request(), 1000 * 60)
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      this.systemProxyInterval.dispose()
      this.systemProxyInterval = null
    }
  }

  private async setGlobalProxy(config: ProxyConfig): Promise<void> {
    await this.getNodeProxyController().configure({
      proxyRules: config.mode === 'direct' ? undefined : config.proxyRules,
      proxyBypassRules: config.proxyBypassRules
    })
    await this.setSessionsProxy(config)
  }

  private getNodeProxyController(): NodeProxyController {
    this.nodeProxyController ??= new NodeProxyController(logger)
    return this.nodeProxyController
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    // `persist:miniapp:*` is deliberately absent: those partitions run a constant deny-all PAC
    // (features/miniApp/runtime/network.ts) that a user proxy change must never overwrite.
    const sessions = [
      session.defaultSession,
      session.fromPartition('persist:webview'),
      session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION)
    ]
    // Await the session AND app proxy config together so a one-shot apply can't fail
    // silently and callers can rely on the proxy being in effect once this resolves.
    await Promise.all([...sessions.map((s) => s.setProxy(config)), app.setProxy(config)])
  }
}
