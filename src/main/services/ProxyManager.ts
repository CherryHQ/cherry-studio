import { application } from '@application'
import { loggerService } from '@logger'
import { createLatestReconciler } from '@main/core/concurrency/latestReconciler'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProxyMode, UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { ProxyConfig } from 'electron'
import { app, session } from 'electron'
import { getSystemProxy } from 'os-proxy-config'

import { NodeProxyController } from './proxy/nodeProxy'

const logger = loggerService.withContext('ProxyManager')

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

@Injectable('ProxyManager')
@ServicePhase(Phase.WhenReady)
export class ProxyManager extends BaseService {
  private systemProxyInterval: Disposable | null = null
  private appliedKey: string | null = null
  private nodeProxyController = new NodeProxyController(logger)

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
    this.proxyReconciler.request()
    await this.proxyReconciler.flush()
    const error = this.proxyReconciler.getLastError()
    if (error) {
      logger.error('Initial proxy apply failed; traffic uses the default route until the next change', error as Error)
    }
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
    this.nodeProxyController.configure({
      proxyRules: config.mode === 'direct' ? undefined : config.proxyRules,
      proxyBypassRules: config.proxyBypassRules
    })
    await this.setSessionsProxy(config)
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    // Await the session AND app proxy config together so a one-shot apply can't fail
    // silently and callers can rely on the proxy being in effect once this resolves.
    await Promise.all([...sessions.map((s) => s.setProxy(config)), app.setProxy(config)])
  }
}
