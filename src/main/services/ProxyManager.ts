import axios from 'axios'
import { app, ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import { getSystemProxy } from 'os-proxy-config'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

import { configManager } from './ConfigManager'

export class ProxyManager {
  private config: ProxyConfig
  private systemProxyInterval: NodeJS.Timeout | null = null
  private originalGlobalDispatcher: Dispatcher
  private originalSocksDispatcher: Dispatcher

  // for http and https
  private originalHttpGet: typeof http.get
  private originalHttpRequest: typeof http.request
  private originalHttpsGet: typeof https.get
  private originalHttpsRequest: typeof https.request

  constructor() {
    this.config = configManager.getProxy()
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = global[Symbol.for('undici.globalDispatcher.1')]
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request

    app.once('ready', () => {
      this.setGlobalProxy()
    })
  }

  private async monitorSystemProxy(): Promise<void> {
    // Clear any existing interval first
    this.clearSystemProxyMonitor()
    // Set new interval
    this.systemProxyInterval = setInterval(async () => {
      await this.setSystemProxy()
    }, 10000)
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      clearInterval(this.systemProxyInterval)
      this.systemProxyInterval = null
    }
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    try {
      this.config = config
      this.clearSystemProxyMonitor()

      if (this.config.mode === 'system') {
        await this.setSystemProxy()
        this.monitorSystemProxy()
      } else if (this.config.mode === 'fixed_servers') {
        await this.setCustomProxy()
      } else {
        await this.clearProxy()
      }

      // Save the proxy config to the config file
      configManager.set('proxy', this.config)
      this.setGlobalProxy()
    } catch (error) {
      console.error('Failed to config proxy:', error)
      throw error
    }
  }

  private setEnvironment(url: string): void {
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

  private async setSystemProxy(): Promise<void> {
    try {
      const currentProxy = await getSystemProxy()
      if (!currentProxy || currentProxy.proxyUrl === this.config.proxyRules) {
        return
      }

      this.config.proxyRules = currentProxy.proxyUrl.toLowerCase()
      this.config.mode = 'system'
    } catch (error) {
      console.error('Failed to set system proxy:', error)
      throw error
    }
  }

  private async setCustomProxy(): Promise<void> {
    try {
      if (this.config.proxyRules) {
        this.config.mode = 'fixed_servers'
      }
    } catch (error) {
      console.error('Failed to set custom proxy:', error)
      throw error
    }
  }

  private clearEnvironment(): void {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.grpc_proxy
    delete process.env.http_proxy
    delete process.env.https_proxy

    delete process.env.SOCKS_PROXY
    delete process.env.ALL_PROXY
  }

  private async clearProxy(): Promise<void> {
    this.clearEnvironment()
    this.config = { mode: 'direct' }
  }

  private setGlobalProxy() {
    this.setEnvironment(this.config.proxyRules || '')
    this.setGlobalFetchProxy(this.config)
    this.setSessionsProxy(this.config)

    this.setGlobalHttpProxy(this.config)
  }

  private setGlobalHttpProxy(config: ProxyConfig) {
    const proxyUrl = config.proxyRules
    if (config.mode === 'direct' || !proxyUrl) {
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

    // agent 设置 rejectUnauthorized 为 false
    // webdav https for self-signed certificate
    agent.options.rejectUnauthorized = false

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
    if (config.mode === 'direct') {
      setGlobalDispatcher(this.originalGlobalDispatcher)
      global[Symbol.for('undici.globalDispatcher.1')] = this.originalSocksDispatcher
      return
    }

    const proxyUrl = config.proxyRules
    if (!proxyUrl) {
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
      host: url.hostname
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
