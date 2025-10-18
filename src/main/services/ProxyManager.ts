import { loggerService } from '@logger'
import axios from 'axios'
import { app, ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import * as ipaddr from 'ipaddr.js'
import { getSystemProxy } from 'os-proxy-config'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const logger = loggerService.withContext('ProxyManager')
let byPassRules: string[] = []

/**
 * Check if a hostname matches a wildcard pattern
 * Supports:
 * - Exact match: "example.com" matches "example.com"
 * - Wildcard subdomain: "*.example.com" matches "sub.example.com", "api.example.com"
 * - Leading dot: ".example.com" is treated as "*.example.com"
 */
export const matchWildcardDomain = (hostname: string, pattern: string): boolean => {
  // Handle leading dot (convert to wildcard)
  const normalizedPattern = pattern.startsWith('.') ? '*' + pattern : pattern

  // Exact match
  if (normalizedPattern === hostname) {
    return true
  }

  // Wildcard match
  if (normalizedPattern.startsWith('*.')) {
    const domain = normalizedPattern.slice(2) // Remove "*."
    return hostname === domain || hostname.endsWith('.' + domain)
  }

  return false
}

/**
 * Check if an IP address matches a rule (single IP, wildcard, or CIDR)
 */
export const matchIpRule = (ip: string, rule: string): boolean => {
  try {
    // Handle IPv6 addresses in brackets
    const cleanIp = ip.replace(/^\[|\]$/g, '')
    const cleanRule = rule.replace(/^\[|\]$/g, '')

    // Check if it's a CIDR notation
    if (cleanRule.includes('/')) {
      const addr = ipaddr.process(cleanIp)
      const [rangeIp, prefix] = cleanRule.split('/')
      const range = ipaddr.process(rangeIp)

      // Validate prefix is a valid number
      const prefixNum = parseInt(prefix)
      if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 128) {
        return false
      }

      // Check if both are same type (IPv4 or IPv6)
      if (addr.kind() !== range.kind()) {
        return false
      }

      return addr.match(range, prefixNum)
    }

    // Handle wildcard IP (e.g., 192.168.1.*)
    if (cleanRule.includes('*')) {
      const rulePattern = cleanRule.replace(/\./g, '\\.').replace(/\*/g, '\\d+')
      return new RegExp(`^${rulePattern}$`).test(cleanIp)
    }

    // Exact IP match
    return cleanIp === cleanRule
  } catch (error) {
    return false
  }
}

const isByPass = (url: string) => {
  if (byPassRules.length === 0) {
    return false
  }

  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname
    const port = parsedUrl.port

    for (const rule of byPassRules) {
      const trimmedRule = rule.trim()
      if (!trimmedRule) {
        continue
      }

      // Special keyword: <local>
      // Matches all hostnames without a dot (local network addresses)
      if (trimmedRule === '<local>') {
        if (!hostname.includes('.') && !hostname.includes(':')) {
          return true
        }
        continue
      }

      // Extract port from rule if present
      const portMatch = trimmedRule.match(/^(.+?):(\d+)$/)
      const ruleHost = portMatch ? portMatch[1] : trimmedRule
      const rulePort = portMatch ? portMatch[2] : null

      // If rule specifies a port, it must match
      if (rulePort && port !== rulePort) {
        continue
      }

      // Try to parse as IP address first
      if (ipaddr.isValid(hostname)) {
        if (matchIpRule(hostname, ruleHost)) {
          return true
        }
        continue
      }

      // Check if rule is an IP-based rule
      if (
        ipaddr.isValid(ruleHost) ||
        ruleHost.includes('/') || // CIDR
        ruleHost.includes('*') // Wildcard IP
      ) {
        // Rule is IP-based but hostname is not an IP, skip
        continue
      }

      // Domain name matching (with wildcard support)
      if (matchWildcardDomain(hostname, ruleHost)) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Failed to check bypass:', error as Error)
    return false
  }
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
      if (isByPass(opts.origin.toString())) {
        logger.info(`bypass proxy: ${opts.origin.toString()}`)
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

  private originalAxiosAdapter

  constructor() {
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = global[Symbol.for('undici.globalDispatcher.1')]
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
    this.originalAxiosAdapter = axios.defaults.adapter
  }

  private async monitorSystemProxy(): Promise<void> {
    // Clear any existing interval first
    this.clearSystemProxyMonitor()
    // Set new interval
    this.systemProxyInterval = setInterval(async () => {
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

      // Support both semicolon and comma as separators
      byPassRules = config.proxyBypassRules
        ? config.proxyBypassRules
            .split(/[;,]/)
            .map((rule) => rule.trim())
            .filter((rule) => rule.length > 0)
        : []
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
      delete process.env.no_proxy

      delete process.env.SOCKS_PROXY
      delete process.env.ALL_PROXY
      return
    }

    process.env.grpc_proxy = url
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    process.env.http_proxy = url
    process.env.https_proxy = url
    process.env.no_proxy = byPassRules.join(',')

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

  // oxlint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
        if (isByPass(url.toString())) {
          logger.info(`bypass proxy: ${url.toString()}`)
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
      this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      axios.defaults.adapter = this.originalAxiosAdapter
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
