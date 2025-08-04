import { loggerService } from '@logger'
import { defaultByPassRules } from '@shared/config/constant'
import axios from 'axios'
import { app, ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import { getSystemProxy } from 'os-proxy-config'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const logger = loggerService.withContext('ProxyManager')
let byPassRules = defaultByPassRules.split(',')

const isByPass = (hostname: string) => {
  return byPassRules.includes(hostname)
}

class SelectiveDispatcher extends Dispatcher {
  private proxyDispatcher: Dispatcher
  private directDispatcher: Dispatcher

  constructor(proxyDispatcher: Dispatcher, directDispatcher: Dispatcher) {
    super()
    this.proxyDispatcher = proxyDispatcher
    this.directDispatcher = directDispatcher
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    if (opts.origin) {
      const url = new URL(opts.origin)
      // 检查是否为 localhost 或本地地址
      if (isByPass(url.hostname)) {
        return this.directDispatcher.dispatch(opts, handler)
      }
    }

    return this.proxyDispatcher.dispatch(opts, handler)
  }

  async close(): Promise<void> {
    try {
      await this.proxyDispatcher.close()
    } catch (error) {
      logger.error('Failed to close dispatcher:', error as Error)
      this.proxyDispatcher.destroy()
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.proxyDispatcher.destroy()
    } catch (error) {
      logger.error('Failed to destroy dispatcher:', error as Error)
    }
  }
}

export class ProxyManager {
  private config: ProxyConfig = { mode: 'direct' }
  private systemProxyInterval: NodeJS.Timeout | null = null
  private isSettingProxy = false

  private proxyDispatcher: Dispatcher | null = null
  private proxyAgent: ProxyAgent | null = null

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
        proxyRules: currentProxy?.proxyUrl.toLowerCase(),
        proxyBypassRules: this.config.proxyBypassRules
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
    logger.info(`configureProxy: ${config?.mode} ${config?.proxyRules} ${config?.proxyBypassRules}`)

    if (this.isSettingProxy) {
      return
    }

    this.isSettingProxy = true

    try {
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

      byPassRules = config.proxyBypassRules?.split(',') || defaultByPassRules.split(',')
      this.setGlobalProxy(this.config)
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

  private setGlobalProxy(config: ProxyConfig) {
    this.setEnvironment(config.proxyRules || '')
    this.setGlobalFetchProxy(config)
    this.setSessionsProxy(config)

    this.setGlobalHttpProxy(config)
  }

  private setGlobalHttpProxy(config: ProxyConfig) {
    if (config.mode === 'direct' || !config.proxyRules) {
      http.get = this.originalHttpGet
      http.request = this.originalHttpRequest
      https.get = this.originalHttpsGet
      https.request = this.originalHttpsRequest
      try {
        this.proxyAgent?.destroy()
      } catch (error) {
        logger.error('Failed to destroy proxy agent:', error as Error)
      }
      this.proxyAgent = null
      return
    }

    // ProxyAgent 从环境变量读取代理配置
    const agent = new ProxyAgent()
    this.proxyAgent = agent
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

      // filter localhost
      if (url) {
        const hostname = typeof url === 'string' ? new URL(url).hostname : url.hostname
        if (isByPass(hostname)) {
          return originalMethod(url, options, callback)
        }
      }

      // for webdav https self-signed certificate
      if (options.agent instanceof https.Agent) {
        ;(agent as https.Agent).options.rejectUnauthorized = options.agent.options.rejectUnauthorized
      }
      options.agent = agent
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
      axios.defaults.adapter = 'http'
      this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      return
    }

    // axios 使用 fetch 代理
    axios.defaults.adapter = 'fetch'

    const url = new URL(proxyUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      this.proxyDispatcher = new SelectiveDispatcher(new EnvHttpProxyAgent(), this.originalGlobalDispatcher)
      setGlobalDispatcher(this.proxyDispatcher)
      return
    }

    this.proxyDispatcher = new SelectiveDispatcher(
      socksDispatcher({
        port: parseInt(url.port),
        type: url.protocol === 'socks4:' ? 4 : 5,
        host: url.hostname,
        userId: url.username || undefined,
        password: url.password || undefined
      }),
      this.originalSocksDispatcher
    )
    global[Symbol.for('undici.globalDispatcher.1')] = this.proxyDispatcher
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))

    // set proxy for electron
    app.setProxy(config)
  }
}

export const proxyManager = new ProxyManager()
