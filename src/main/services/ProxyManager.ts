import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import axios from 'axios'
import type { ProxyConfig } from 'electron'
import { app, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import * as ipaddr from 'ipaddr.js'
import { getSystemProxy } from 'os-proxy-config'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const logger = loggerService.withContext('ProxyManager')

type HostnameMatchType = 'exact' | 'wildcardSubdomain' | 'generalWildcard'

const enum ProxyBypassRuleType {
  Local = 'local',
  Cidr = 'cidr',
  Ip = 'ip',
  Domain = 'domain'
}

interface ParsedProxyBypassRule {
  type: ProxyBypassRuleType
  matchType: HostnameMatchType
  rule: string
  scheme?: string
  port?: string
  domain?: string
  regex?: RegExp
  cidr?: [ipaddr.IPv4 | ipaddr.IPv6, number]
  ip?: string
}

const getDefaultPortForProtocol = (protocol: string): string | null => {
  switch (protocol.toLowerCase()) {
    case 'http:':
      return '80'
    case 'https:':
      return '443'
    default:
      return null
  }
}

const buildWildcardRegex = (pattern: string): RegExp => {
  const escapedSegments = pattern.split('*').map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escapedSegments.join('.*')}$`, 'i')
}

const isWildcardIp = (value: string): boolean => {
  if (!value.includes('*')) {
    return false
  }
  const replaced = value.replace(/\*/g, '0')
  return ipaddr.isValid(replaced)
}

const matchHostnameRule = (hostname: string, rule: ParsedProxyBypassRule): boolean => {
  const normalizedHostname = hostname.toLowerCase()

  switch (rule.matchType) {
    case 'exact':
      return normalizedHostname === rule.domain
    case 'wildcardSubdomain': {
      const domain = rule.domain
      if (!domain) {
        return false
      }
      return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
    }
    case 'generalWildcard':
      return rule.regex ? rule.regex.test(normalizedHostname) : false
    default:
      return false
  }
}

const parseProxyBypassRule = (rule: string): ParsedProxyBypassRule | null => {
  const trimmedRule = rule.trim()
  if (!trimmedRule) {
    return null
  }

  if (trimmedRule === '<local>') {
    return {
      type: ProxyBypassRuleType.Local,
      matchType: 'exact',
      rule: '<local>'
    }
  }

  let workingRule = trimmedRule
  let scheme: string | undefined
  const schemeMatch = workingRule.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):\/\//)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    workingRule = workingRule.slice(schemeMatch[0].length)
  }

  // CIDR notation must be processed before port extraction
  if (workingRule.includes('/')) {
    const cleanedCidr = workingRule.replace(/^\[|\]$/g, '')
    if (ipaddr.isValidCIDR(cleanedCidr)) {
      return {
        type: ProxyBypassRuleType.Cidr,
        matchType: 'exact',
        rule: workingRule,
        scheme,
        cidr: ipaddr.parseCIDR(cleanedCidr)
      }
    }
  }

  // Extract port: supports "host:port" and "[ipv6]:port" formats
  let port: string | undefined
  const portMatch = workingRule.match(/^(.+?):(\d+)$/)
  if (portMatch) {
    // For IPv6, ensure we're not splitting inside the brackets
    const potentialHost = portMatch[1]
    if (!potentialHost.startsWith('[') || potentialHost.includes(']')) {
      workingRule = potentialHost
      port = portMatch[2]
    }
  }

  const cleanedHost = workingRule.replace(/^\[|\]$/g, '')
  const normalizedHost = cleanedHost.toLowerCase()

  if (!cleanedHost) {
    return null
  }

  if (ipaddr.isValid(cleanedHost)) {
    return {
      type: ProxyBypassRuleType.Ip,
      matchType: 'exact',
      rule: cleanedHost,
      scheme,
      port,
      ip: cleanedHost
    }
  }

  if (isWildcardIp(cleanedHost)) {
    const regexPattern = cleanedHost.replace(/\./g, '\\.').replace(/\*/g, '\\d+')
    return {
      type: ProxyBypassRuleType.Ip,
      matchType: 'generalWildcard',
      rule: cleanedHost,
      scheme,
      port,
      regex: new RegExp(`^${regexPattern}$`)
    }
  }

  if (workingRule.startsWith('*.')) {
    const domain = normalizedHost.slice(2)
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'wildcardSubdomain',
      rule: workingRule,
      scheme,
      port,
      domain
    }
  }

  if (workingRule.startsWith('.')) {
    const domain = normalizedHost.slice(1)
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'wildcardSubdomain',
      rule: workingRule,
      scheme,
      port,
      domain
    }
  }

  if (workingRule.includes('*')) {
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'generalWildcard',
      rule: workingRule,
      scheme,
      port,
      regex: buildWildcardRegex(normalizedHost)
    }
  }

  return {
    type: ProxyBypassRuleType.Domain,
    matchType: 'exact',
    rule: workingRule,
    scheme,
    port,
    domain: normalizedHost
  }
}

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost') {
    return true
  }

  const cleaned = hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(cleaned)) {
    const parsed = ipaddr.parse(cleaned)
    return parsed.range() === 'loopback'
  }

  return false
}

class SelectiveDispatcher extends Dispatcher {
  private proxyDispatcher: Dispatcher
  private directDispatcher: Dispatcher
  private isByPassFn: (url: string) => boolean

  constructor(proxyDispatcher: Dispatcher, directDispatcher: Dispatcher, isByPassFn: (url: string) => boolean) {
    super()
    this.proxyDispatcher = proxyDispatcher
    this.directDispatcher = directDispatcher
    this.isByPassFn = isByPassFn
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    if (opts.origin) {
      if (this.isByPassFn(opts.origin.toString())) {
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
      void this.proxyDispatcher.destroy()
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

@Injectable('ProxyManager')
@ServicePhase(Phase.WhenReady)
export class ProxyManager extends BaseService {
  private static readonly PROXY_KEYS = ['app.proxy.mode', 'app.proxy.url', 'app.proxy.bypass_rules'] as const

  private config: ProxyConfig = { mode: 'direct' }
  private systemProxyInterval: NodeJS.Timeout | null = null
  private isSettingProxy = false
  private pendingReconfiguration = false

  private byPassRules: string[] = []
  private parsedByPassRules: ParsedProxyBypassRule[] = []

  private proxyDispatcher: Dispatcher | null = null
  private proxyAgent: ProxyAgent | null = null

  private originalGlobalDispatcher: Dispatcher
  private originalSocksDispatcher: Dispatcher
  // for http and https
  private originalHttpGet: typeof http.get
  private originalHttpRequest: typeof http.request
  private originalHttpsGet: typeof https.get
  private originalHttpsRequest: typeof https.request

  private originalAxiosAdapter: typeof axios.defaults.adapter

  constructor() {
    super()
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = global[Symbol.for('undici.globalDispatcher.1')]
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
    this.originalAxiosAdapter = axios.defaults.adapter
  }

  protected async onInit(): Promise<void> {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeMultipleChanges(
        [...ProxyManager.PROXY_KEYS],
        () => void this.applyProxyFromPreferences()
      )
    )
  }

  protected async onReady(): Promise<void> {
    // direct is the constructor default — skip redundant reconfiguration
    const mode = application.get('PreferenceService').get('app.proxy.mode')
    if (mode === 'none') return
    await this.applyProxyFromPreferences()
  }

  protected async onStop(): Promise<void> {
    // 1. Stop system proxy monitoring timer
    this.clearSystemProxyMonitor()
    // 2. Restore global fetch dispatcher, close proxyDispatcher
    setGlobalDispatcher(this.originalGlobalDispatcher)
    global[Symbol.for('undici.globalDispatcher.1')] = this.originalSocksDispatcher
    if (this.proxyDispatcher) {
      try {
        await this.proxyDispatcher.close()
      } catch {
        /* best effort */
      }
      this.proxyDispatcher = null
    }
    axios.defaults.adapter = this.originalAxiosAdapter
    // 3. Restore http/https original methods, destroy proxyAgent
    http.get = this.originalHttpGet
    http.request = this.originalHttpRequest
    https.get = this.originalHttpsGet
    https.request = this.originalHttpsRequest
    if (this.proxyAgent) {
      try {
        this.proxyAgent.destroy()
      } catch {
        /* best effort */
      }
      this.proxyAgent = null
    }
    // 4. Clear environment variables
    this.setEnvironment('')
    // 5. Reset Electron session proxy
    try {
      await this.setSessionsProxy({ mode: 'direct' })
    } catch {
      /* shutdown safety */
    }
    // 6. Reset internal state
    this.config = { mode: 'direct' }
    this.byPassRules = []
    this.parsedByPassRules = []
    this.pendingReconfiguration = false
  }

  private async applyProxyFromPreferences(): Promise<void> {
    const preferenceService = application.get('PreferenceService')
    const { mode, url, bypassRules } = preferenceService.getMultiple({
      mode: 'app.proxy.mode' as const,
      url: 'app.proxy.url' as const,
      bypassRules: 'app.proxy.bypass_rules' as const
    })

    // mode='custom' but url is empty: no-op, keep current proxy unchanged
    // Matches original renderer short-circuit: void (proxyUrl && window.api.setProxy(...))
    if (mode === 'custom' && !url) {
      return
    }

    let proxyConfig: ProxyConfig
    if (mode === 'system') {
      proxyConfig = { mode: 'system' }
    } else if (mode === 'custom') {
      proxyConfig = { mode: 'fixed_servers', proxyRules: url, proxyBypassRules: bypassRules }
    } else {
      proxyConfig = { mode: 'direct' }
    }

    await this.configureProxy(proxyConfig)
  }

  public updateByPassRules(rules: string[]): void {
    this.byPassRules = rules
    this.parsedByPassRules = []

    for (const rule of rules) {
      const parsedRule = parseProxyBypassRule(rule)
      if (parsedRule) {
        this.parsedByPassRules.push(parsedRule)
      } else {
        logger.warn(`Skipping invalid proxy bypass rule: ${rule}`)
      }
    }
  }

  public isByPass(url: string) {
    if (this.parsedByPassRules.length === 0) {
      return false
    }

    try {
      const parsedUrl = new URL(url)
      const hostname = parsedUrl.hostname
      const cleanedHostname = hostname.replace(/^\[|\]$/g, '')
      const protocol = parsedUrl.protocol
      const protocolName = protocol.replace(':', '').toLowerCase()
      const defaultPort = getDefaultPortForProtocol(protocol)
      const port = parsedUrl.port || defaultPort || ''
      const hostnameIsIp = ipaddr.isValid(cleanedHostname)

      for (const rule of this.parsedByPassRules) {
        if (rule.scheme && rule.scheme !== protocolName) {
          continue
        }

        if (rule.port && rule.port !== port) {
          continue
        }

        switch (rule.type) {
          case ProxyBypassRuleType.Local:
            if (isLocalHostname(hostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Ip:
            if (!hostnameIsIp) {
              break
            }

            if (rule.ip && cleanedHostname === rule.ip) {
              return true
            }

            if (rule.regex && rule.regex.test(cleanedHostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Cidr:
            if (hostnameIsIp && rule.cidr) {
              const parsedHost = ipaddr.parse(cleanedHostname)
              const [cidrAddress, prefixLength] = rule.cidr
              // Ensure IP version matches before comparing
              if (parsedHost.kind() === cidrAddress.kind() && parsedHost.match([cidrAddress, prefixLength])) {
                return true
              }
            }
            break
          case ProxyBypassRuleType.Domain:
            if (!hostnameIsIp && matchHostnameRule(hostname, rule)) {
              return true
            }
            break
          default:
            logger.error(`Unknown proxy bypass rule type: ${rule.type}`)
            break
        }
      }
    } catch (error) {
      logger.error('Failed to check bypass:', error as Error)
      return false
    }
    return false
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

  private async configureProxy(config: ProxyConfig): Promise<void> {
    logger.info(`configureProxy: ${config?.mode} ${config?.proxyRules} ${config?.proxyBypassRules}`)

    if (this.isSettingProxy) {
      this.pendingReconfiguration = true
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

      // Support both semicolon and comma as separators
      if (config.proxyBypassRules !== this.config.proxyBypassRules) {
        const rawRules = config.proxyBypassRules
          ? config.proxyBypassRules
              .split(/[;,]/)
              .map((rule) => rule.trim())
              .filter((rule) => rule.length > 0)
          : []

        this.updateByPassRules(rawRules)
      }

      this.setGlobalProxy(config)
      this.config = config
    } catch (error) {
      logger.error('Failed to config proxy:', error as Error)
      throw error
    } finally {
      this.isSettingProxy = false
      if (this.pendingReconfiguration) {
        this.pendingReconfiguration = false
        void this.applyProxyFromPreferences()
      }
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
    process.env.no_proxy = this.byPassRules.join(',')

    if (url.startsWith('socks')) {
      process.env.SOCKS_PROXY = url
      process.env.ALL_PROXY = url
    }
  }

  private setGlobalProxy(config: ProxyConfig) {
    this.setEnvironment(config.proxyRules || '')
    this.setGlobalFetchProxy(config)
    void this.setSessionsProxy(config)

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

    // ProxyAgent reads proxy configuration from environment variables
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
        if (this.isByPass(url.toString())) {
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
      void this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      axios.defaults.adapter = this.originalAxiosAdapter
      return
    }

    // axios uses fetch proxy
    axios.defaults.adapter = 'fetch'

    const url = new URL(proxyUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      this.proxyDispatcher = new SelectiveDispatcher(
        new EnvHttpProxyAgent(),
        this.originalGlobalDispatcher,
        this.isByPass.bind(this)
      )
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
      this.originalSocksDispatcher,
      this.isByPass.bind(this)
    )
    global[Symbol.for('undici.globalDispatcher.1')] = this.proxyDispatcher
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))

    // set proxy for electron
    void app.setProxy(config)
  }
}
