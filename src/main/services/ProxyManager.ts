import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProxyMode } from '@shared/data/preference/preferenceTypes'
import type { ProxyConfig } from 'electron'
import { app, session } from 'electron'
import { getSystemProxy } from 'os-proxy-config'

import { NodeProxyController } from './proxy/nodeProxy'

const logger = loggerService.withContext('ProxyManager')

/** Proxy preferences that drive the global proxy. Changing any of them re-applies it. */
const PROXY_PREFERENCE_KEYS = ['app.proxy.mode', 'app.proxy.url', 'app.proxy.bypass_rules'] as const

/**
 * Map the user-facing proxy mode to an Electron {@link ProxyConfig}. `system` returns the
 * bare `system` mode and lets {@link ProxyManager.configureProxy} resolve the concrete
 * system proxy URL from the OS. A `custom` mode without a URL can't form a fixed-servers
 * config, so it falls back to direct.
 */
export function resolveProxyConfig(mode: ProxyMode, url: string, bypassRules: string): ProxyConfig {
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
  private config: ProxyConfig = { mode: 'direct' }
  private systemProxyInterval: Disposable | null = null
  private isSettingProxy = false
  private nodeProxyController = new NodeProxyController(logger)

  /**
   * Apply the proxy from user preferences on startup, then re-apply whenever the proxy
   * preferences change. Without this the global proxy mechanism is never wired to
   * settings — changing the proxy in the UI would have no effect on the network stack.
   */
  protected async onReady(): Promise<void> {
    await this.applyProxyFromPreferences()
    this.registerDisposable(
      application.get('PreferenceService').subscribeMultipleChanges([...PROXY_PREFERENCE_KEYS], () => {
        void this.applyProxyFromPreferences()
      })
    )
  }

  private async applyProxyFromPreferences(): Promise<void> {
    const preferenceService = application.get('PreferenceService')
    const config = resolveProxyConfig(
      preferenceService.get('app.proxy.mode'),
      preferenceService.get('app.proxy.url'),
      preferenceService.get('app.proxy.bypass_rules')
    )
    try {
      await this.configureProxy(config)
    } catch (error) {
      logger.error('Failed to apply proxy from preferences:', error as Error)
    }
  }

  private async monitorSystemProxy(): Promise<void> {
    this.clearSystemProxyMonitor()
    this.systemProxyInterval = this.registerInterval(async () => {
      const currentProxy = await getSystemProxy()
      if (
        currentProxy?.proxyUrl.toLowerCase() === this.config?.proxyRules &&
        currentProxy?.noProxy.join(',').toLowerCase() === this.config?.proxyBypassRules?.toLowerCase()
      ) {
        return
      }

      logger.info(
        `system proxy changed: ${currentProxy?.proxyUrl}, this.config.proxyRules: ${this.config.proxyRules}, this.config.proxyBypassRules: ${this.config.proxyBypassRules}`
      )
      await this.configureProxy({
        mode: 'system',
        proxyRules: currentProxy?.proxyUrl.toLowerCase(),
        proxyBypassRules: currentProxy?.noProxy.join(',')
      })
    }, 1000 * 60)
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      this.systemProxyInterval.dispose()
      this.systemProxyInterval = null
    }
  }

  private async configureProxy(config: ProxyConfig): Promise<void> {
    logger.info(`configureProxy: ${config?.mode} ${config?.proxyRules} ${config?.proxyBypassRules}`)

    if (this.isSettingProxy) {
      logger.info('Proxy configuration already in progress, skipping')
      return
    }

    this.isSettingProxy = true

    try {
      this.clearSystemProxyMonitor()
      if (config.mode === 'system') {
        const currentProxy = await getSystemProxy()
        if (currentProxy) {
          logger.info(`current system proxy: ${currentProxy.proxyUrl}, bypass rules: ${currentProxy.noProxy.join(',')}`)
          config.proxyRules = currentProxy.proxyUrl.toLowerCase()
          config.proxyBypassRules = currentProxy.noProxy.join(',')
        }
        void this.monitorSystemProxy()
      }

      await this.setGlobalProxy(config)
      this.config = config
    } catch (error) {
      logger.error('Failed to config proxy:', error as Error)
      throw error
    } finally {
      this.isSettingProxy = false
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
