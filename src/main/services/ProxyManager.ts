import { loggerService } from '@logger'
import axios from 'axios'
import { app, ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import { getSystemProxy } from 'os-proxy-config'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const logger = loggerService.withContext('ProxyManager')

export class ProxyManager {
  private config: ProxyConfig = { mode: 'direct' }
  private systemProxyInterval: NodeJS.Timeout | null = null
  private isSettingProxy = false

  private originalGlobalDispatcher: Dispatcher
  private originalSocksDispatcher: Dispatcher
  // for http and https
  private originalHttpGet: typeof http.get
  private originalHttpRequest: typeof http.request
  private originalHttpsGet: typeof https.get
  private originalHttpsRequest: typeof https.request

  constructor() {
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = global[Symbol.for('undici.globalDispatcher.1')]
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
  }

  private async monitorSystemProxy(): Promise<void> {
    // Clear any existing interval first
    this.clearSystemProxyMonitor()
    // Set new interval
    this.systemProxyInterval = setInterval(async () => {
      const currentProxy = await getSystemProxy()
      if (currentProxy && currentProxy.proxyUrl.toLowerCase() === this.config?.proxyRules) {
        return
      }

      await this.configureProxy({
        mode: 'system',
        proxyRules: currentProxy?.proxyUrl.toLowerCase()
      })
    }, 1000 * 60)
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      clearInterval(this.systemProxyInterval)
      this.systemProxyInterval = null
    }
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    logger.debug(`configureProxy: ${config?.mode} ${config?.proxyRules}`)
    if (this.isSettingProxy) {
      return
    }

    this.isSettingProxy = true

    try {
      if (config?.mode === this.config?.mode && config?.proxyRules === this.config?.proxyRules) {
        logger.info('proxy config is the same, skip configure')
        return
      }

      this.config = config
      this.clearSystemProxyMonitor()
      if (config.mode === 'system') {
        const currentProxy = await getSystemProxy()
        if (currentProxy) {
          logger.info(`current system proxy: ${currentProxy.proxyUrl}`)
          this.config.proxyRules = currentProxy.proxyUrl.toLowerCase()
        }
        this.monitorSystemProxy()
      }

      this.setGlobalProxy()
    } catch (error) {
      logger.error('Failed to config proxy:', error as Error)
      throw error
    } finally {
      this.isSettingProxy = false
    }
  }

  private setEnvironment(url: string): void {
    if (url === '') {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.grpc_proxy
      delete process.env.http_proxy
      delete process.env.https_proxy

      delete process.env.SOCKS_PROXY
      delete process.env.ALL_PROXY
      return
    }

    process.env.grpc_proxy = url
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    process.env.http_proxy = url
    process.env.https_proxy = url

    if (url.startsWith('socks')) {
      process.env.SOCKS_PROXY = url
      process.env.ALL_PROXY = url
    }
  }

  private setGlobalProxy() {
    this.setEnvironment(this.config.proxyRules || '')
    this.setGlobalFetchProxy(this.config)
    this.setSessionsProxy(this.config)

    this.setGlobalHttpProxy(this.config)
  }

  private setGlobalHttpProxy(config: ProxyConfig) {
    if (config.mode === 'direct' || !config.proxyRules) {
      http.get = this.originalHttpGet
      http.request = this.originalHttpRequest
      https.get = this.originalHttpsGet
      https.request = this.originalHttpsRequest

      axios.defaults.proxy = undefined
      axios.defaults.httpAgent = undefined
      axios.defaults.httpsAgent = undefined
      return
    }

    // ProxyAgent 从环境变量读取代理配置
    const agent = new ProxyAgent()

    // axios 使用代理
    axios.defaults.proxy = false
    axios.defaults.httpAgent = agent
    axios.defaults.httpsAgent = agent

    http.get = this.bindHttpMethod(this.originalHttpGet, agent)
    http.request = this.bindHttpMethod(this.originalHttpRequest, agent)

    https.get = this.bindHttpMethod(this.originalHttpsGet, agent)
    https.request = this.bindHttpMethod(this.originalHttpsRequest, agent)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private bindHttpMethod(originalMethod: Function, agent: http.Agent | https.Agent) {
    return (...args: any[]) => {
      let url: string | URL | undefined
      let options: http.RequestOptions | https.RequestOptions
      let callback: (res: http.IncomingMessage) => void

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = args[0]
        if (typeof args[1] === 'function') {
          options = {}
          callback = args[1]
        } else {
          options = {
            ...args[1]
          }
          callback = args[2]
        }
      } else {
        options = {
          ...args[0]
        }
        callback = args[1]
      }

      // for webdav https self-signed certificate
      if (options.agent instanceof https.Agent) {
        ;(agent as https.Agent).options.rejectUnauthorized = options.agent.options.rejectUnauthorized
      }

      // 确保只设置 agent，不修改其他网络选项
      if (!options.agent) {
        options.agent = agent
      }

      if (url) {
        return originalMethod(url, options, callback)
      }
      return originalMethod(options, callback)
    }
  }

  private setGlobalFetchProxy(config: ProxyConfig) {
    const proxyUrl = config.proxyRules
    if (config.mode === 'direct' || !proxyUrl) {
      setGlobalDispatcher(this.originalGlobalDispatcher)
      global[Symbol.for('undici.globalDispatcher.1')] = this.originalSocksDispatcher
      return
    }

    const url = new URL(proxyUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      setGlobalDispatcher(new EnvHttpProxyAgent())
      return
    }

    global[Symbol.for('undici.globalDispatcher.1')] = socksDispatcher({
      port: parseInt(url.port),
      type: url.protocol === 'socks4:' ? 4 : 5,
      host: url.hostname,
      userId: url.username || undefined,
      password: url.password || undefined
    })
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))

    // set proxy for electron
    app.setProxy(config)
  }
}

export const proxyManager = new ProxyManager()
