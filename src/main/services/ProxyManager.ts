import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProxyConfig } from 'electron'
import { app, session } from 'electron'
import * as net from 'net'
import { getSystemProxy } from 'os-proxy-config'

import { NodeProxyController } from './proxy/nodeProxy'

const logger = loggerService.withContext('ProxyManager')

/**
 * TCP probe proxy address availability
 * Used to detect whether system proxy config points to an actually running proxy service
 */
export function isProxyReachable(proxyUrl: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl)
      const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80)
      const socket = new net.Socket()

      const onError = () => {
        socket.destroy()
        resolve(false)
      }

      const onTimeout = () => {
        socket.destroy()
        resolve(false)
      }

      socket.setTimeout(timeoutMs)
      socket.once('error', onError)
      socket.once('timeout', onTimeout)
      socket.connect(port, url.hostname, () => {
        socket.destroy()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

@Injectable('ProxyManager')
@ServicePhase(Phase.WhenReady)
export class ProxyManager extends BaseService {
  private config: ProxyConfig = { mode: 'direct' }
  private systemProxyInterval: Disposable | null = null
  private isSettingProxy = false
  private nodeProxyController = new NodeProxyController(logger)

  private async monitorSystemProxy(): Promise<void> {
    this.clearSystemProxyMonitor()
    this.systemProxyInterval = this.registerInterval(async () => {
      const currentProxy = await getSystemProxy()
      const currentProxyUrl = currentProxy?.proxyUrl.toLowerCase()
      const currentBypassRules = currentProxy?.noProxy.join(',').toLowerCase()
      const lastProxyUrl = this.config?.proxyRules?.toLowerCase()
      const lastBypassRules = this.config?.proxyBypassRules?.toLowerCase()

      // 如果系统代理配置没有变化，不需要重新配置
      if (currentProxyUrl === lastProxyUrl && currentBypassRules === lastBypassRules) {
        return
      }

      logger.info(
        `system proxy changed: ${currentProxyUrl}, this.config.proxyRules: ${this.config.proxyRules}, this.config.proxyBypassRules: ${this.config.proxyBypassRules}`
      )
      await this.configureProxy({
        mode: 'system',
        proxyRules: currentProxyUrl,
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
          const proxyUrl = currentProxy.proxyUrl.toLowerCase()
          const isReachable = await isProxyReachable(proxyUrl)
          if (isReachable) {
            logger.info(`current system proxy: ${proxyUrl}, bypass rules: ${currentProxy.noProxy.join(',')}`)
            config.proxyRules = proxyUrl
            config.proxyBypassRules = currentProxy.noProxy.join(',')
          } else {
            logger.warn(`system proxy ${proxyUrl} is configured but not reachable, falling back to direct mode`)
            config.proxyRules = undefined
            config.proxyBypassRules = undefined
          }
        }
        void this.monitorSystemProxy()
      }

      this.setGlobalProxy(config)
      this.config = config
    } catch (error) {
      logger.error('Failed to config proxy:', error as Error)
      throw error
    } finally {
      this.isSettingProxy = false
    }
  }

  private setGlobalProxy(config: ProxyConfig) {
    this.nodeProxyController.configure({
      proxyRules: config.mode === 'direct' ? undefined : config.proxyRules,
      proxyBypassRules: config.proxyBypassRules
    })
    void this.setSessionsProxy(config)
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))

    void app.setProxy(config)
  }
}
