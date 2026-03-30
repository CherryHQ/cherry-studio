import axios from 'axios'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import * as ipaddr from 'ipaddr.js'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

export const CHERRY_NODE_PROXY_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_RULES'
export const CHERRY_NODE_PROXY_BYPASS_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES'

export interface NodeProxyConfig {
  proxyRules?: string
  proxyBypassRules?: string
}

interface NodeProxyLogger {
  error?: (message: string, ...data: any[]) => void
  warn?: (message: string, ...data: any[]) => void
}

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

const SOCKS_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const globalDispatcherRegistry = globalThis as typeof globalThis & Record<symbol, Dispatcher | undefined>

let parsedByPassRules: ParsedProxyBypassRule[] = []

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

  let port: string | undefined
  const portMatch = workingRule.match(/^(.+?):(\d+)$/)
  if (portMatch) {
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

export const normalizeProxyBypassRules = (rules?: string): string[] => {
  return rules
    ? rules
        .split(/[;,]/)
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0)
    : []
}

export const getProxyProtocol = (proxyRules?: string): string | null => {
  if (!proxyRules) {
    return null
  }

  return new URL(proxyRules).protocol.replace(':', '').toLowerCase()
}

export const isSocksProxyProtocol = (protocol: string | null): boolean => {
  return protocol !== null && protocol.startsWith('socks')
}

export const updateByPassRules = (rules: string[], logger?: NodeProxyLogger): void => {
  parsedByPassRules = []

  for (const rule of rules) {
    const parsedRule = parseProxyBypassRule(rule)
    if (parsedRule) {
      parsedByPassRules.push(parsedRule)
    } else {
      logger?.warn?.(`Skipping invalid proxy bypass rule: ${rule}`)
    }
  }
}

export const isByPass = (url: string, logger?: NodeProxyLogger) => {
  if (parsedByPassRules.length === 0) {
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

    for (const rule of parsedByPassRules) {
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
          logger?.error?.(`Unknown proxy bypass rule type: ${rule.type}`)
          break
      }
    }
  } catch (error) {
    logger?.error?.('Failed to check bypass:', error as Error)
    return false
  }

  return false
}

export const buildNodeProxyEnvironment = (config: NodeProxyConfig): Record<string, string> => {
  const proxyUrl = config.proxyRules?.trim()
  if (!proxyUrl) {
    return {}
  }

  const normalizedByPassRules = normalizeProxyBypassRules(config.proxyBypassRules)
  const proxyProtocol = getProxyProtocol(proxyUrl)
  const env: Record<string, string> = {
    [CHERRY_NODE_PROXY_RULES_ENV]: proxyUrl,
    [CHERRY_NODE_PROXY_BYPASS_RULES_ENV]: normalizedByPassRules.join(',')
  }

  if (normalizedByPassRules.length > 0) {
    env.NO_PROXY = normalizedByPassRules.join(',')
    env.no_proxy = normalizedByPassRules.join(',')
  }

  if (isSocksProxyProtocol(proxyProtocol)) {
    env.SOCKS_PROXY = proxyUrl
    env.socks_proxy = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.all_proxy = proxyUrl
    return env
  }

  env.grpc_proxy = proxyUrl
  env.HTTP_PROXY = proxyUrl
  env.HTTPS_PROXY = proxyUrl
  env.http_proxy = proxyUrl
  env.https_proxy = proxyUrl
  env.ALL_PROXY = proxyUrl
  env.all_proxy = proxyUrl

  return env
}

class SelectiveDispatcher extends Dispatcher {
  constructor(
    private proxyDispatcher: Dispatcher,
    private directDispatcher: Dispatcher,
    private logger?: NodeProxyLogger
  ) {
    super()
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    if (opts.origin && isByPass(opts.origin.toString(), this.logger)) {
      return this.directDispatcher.dispatch(opts, handler)
    }

    return this.proxyDispatcher.dispatch(opts, handler)
  }

  async close(): Promise<void> {
    try {
      await this.proxyDispatcher.close()
    } catch (error) {
      this.logger?.error?.('Failed to close dispatcher:', error as Error)
      void this.proxyDispatcher.destroy()
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.proxyDispatcher.destroy()
    } catch (error) {
      this.logger?.error?.('Failed to destroy dispatcher:', error as Error)
    }
  }
}

export class NodeProxyController {
  private proxyDispatcher: Dispatcher | null = null
  private proxyAgent: ProxyAgent | null = null

  private readonly originalGlobalDispatcher: Dispatcher
  private readonly originalSocksDispatcher: Dispatcher
  private readonly originalHttpGet: typeof http.get
  private readonly originalHttpRequest: typeof http.request
  private readonly originalHttpsGet: typeof https.get
  private readonly originalHttpsRequest: typeof https.request
  private readonly originalAxiosAdapter

  constructor(private logger?: NodeProxyLogger) {
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] ?? this.originalGlobalDispatcher
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
    this.originalAxiosAdapter = axios.defaults.adapter
  }

  configure(config: NodeProxyConfig): void {
    const proxyUrl = config.proxyRules?.trim()
    const normalizedByPassRules = normalizeProxyBypassRules(config.proxyBypassRules)

    updateByPassRules(normalizedByPassRules, this.logger)
    this.setEnvironment(proxyUrl, normalizedByPassRules)
    this.setGlobalFetchProxy(proxyUrl)
    this.setGlobalHttpProxy(proxyUrl)
  }

  private setEnvironment(url: string | undefined, normalizedByPassRules: string[]): void {
    delete process.env[CHERRY_NODE_PROXY_RULES_ENV]
    delete process.env[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.grpc_proxy
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    delete process.env.SOCKS_PROXY
    delete process.env.socks_proxy
    delete process.env.ALL_PROXY
    delete process.env.all_proxy

    if (!url) {
      return
    }

    const env = buildNodeProxyEnvironment({
      proxyRules: url,
      proxyBypassRules: normalizedByPassRules.join(',')
    })

    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }
  }

  private setGlobalHttpProxy(proxyUrl: string | undefined) {
    if (!proxyUrl) {
      http.get = this.originalHttpGet
      http.request = this.originalHttpRequest
      https.get = this.originalHttpsGet
      https.request = this.originalHttpsRequest

      try {
        this.proxyAgent?.destroy()
      } catch (error) {
        this.logger?.error?.('Failed to destroy proxy agent:', error as Error)
      }

      this.proxyAgent = null
      return
    }

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
      let callback: ((res: http.IncomingMessage) => void) | undefined

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

      if (url && isByPass(url.toString(), this.logger)) {
        return originalMethod(url, options, callback)
      }

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

  private setGlobalFetchProxy(proxyUrl: string | undefined) {
    if (!proxyUrl) {
      setGlobalDispatcher(this.originalGlobalDispatcher)
      globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.originalSocksDispatcher
      void this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      axios.defaults.adapter = this.originalAxiosAdapter
      return
    }

    axios.defaults.adapter = 'fetch'

    const url = new URL(proxyUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      this.proxyDispatcher = new SelectiveDispatcher(
        new EnvHttpProxyAgent(),
        this.originalGlobalDispatcher,
        this.logger
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
      this.logger
    )
    setGlobalDispatcher(this.proxyDispatcher)
    globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.proxyDispatcher
  }
}

const bootstrapNodeProxyController = new NodeProxyController()

export const applyNodeProxyFromEnvironment = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const proxyRules = env[CHERRY_NODE_PROXY_RULES_ENV]
  if (!proxyRules) {
    return false
  }

  bootstrapNodeProxyController.configure({
    proxyRules,
    proxyBypassRules: env[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]
  })

  return true
}
