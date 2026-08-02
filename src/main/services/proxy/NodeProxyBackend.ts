import http from 'node:http'
import https from 'node:https'

import axios from 'axios'
import { socksDispatcher } from 'fetch-socks'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

import { type NodeProxyLogger, ProxyBypassRuleMatcher } from './bypassRules'
import type { ProxyEndpoint } from './proxyRouting'

const SOCKS_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const globalDispatcherRegistry = globalThis as typeof globalThis & Record<symbol, Dispatcher | undefined>

interface HttpProxyAgents {
  http: http.Agent
  https: http.Agent
}

class SelectiveDispatcher extends Dispatcher {
  constructor(
    private proxyDispatcher: Dispatcher,
    private directDispatcher: Dispatcher,
    private shouldByPass: (url: string) => boolean,
    private logger?: NodeProxyLogger
  ) {
    super()
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    if (opts.origin && this.shouldByPass(opts.origin.toString())) {
      return this.directDispatcher.dispatch(opts, handler)
    }
    return this.proxyDispatcher.dispatch(opts, handler)
  }

  async close(): Promise<void> {
    try {
      await this.proxyDispatcher.close()
    } catch (error) {
      this.logger?.error?.('Failed to close dispatcher:', error)
      void this.proxyDispatcher.destroy()
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.proxyDispatcher.destroy()
    } catch (error) {
      this.logger?.error?.('Failed to destroy dispatcher:', error)
    }
  }
}

export class NodeProxyBackend {
  private proxyDispatcher: Dispatcher | null = null
  private httpProxyAgents: HttpProxyAgents | null = null
  private readonly proxyBypassRuleMatcher = new ProxyBypassRuleMatcher()
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

  async configure(
    proxyUrl: string | undefined,
    endpoint: ProxyEndpoint | null,
    bypassRules: string[],
    applyEnvironment: () => void
  ): Promise<void> {
    const httpProxyAgents = endpoint ? await this.createHttpProxyAgents(proxyUrl!, endpoint) : null
    this.proxyBypassRuleMatcher.updateByPassRules(bypassRules, this.logger)
    applyEnvironment()
    this.setGlobalFetchProxy(endpoint)
    this.setGlobalHttpProxy(httpProxyAgents)
  }

  private async createHttpProxyAgents(proxyUrl: string, endpoint: ProxyEndpoint): Promise<HttpProxyAgents> {
    if (endpoint.kind === 'socks') {
      const { SocksProxyAgent } = await import('socks-proxy-agent')
      return { http: new SocksProxyAgent(proxyUrl), https: new SocksProxyAgent(proxyUrl) }
    }

    const [{ HttpProxyAgent }, { HttpsProxyAgent }] = await Promise.all([
      import('http-proxy-agent'),
      import('https-proxy-agent')
    ])
    return { http: new HttpProxyAgent(endpoint.url), https: new HttpsProxyAgent(endpoint.url) }
  }

  private setGlobalHttpProxy(agents: HttpProxyAgents | null): void {
    const previousAgents = this.httpProxyAgents
    this.httpProxyAgents = agents

    if (!agents) {
      http.get = this.originalHttpGet
      http.request = this.originalHttpRequest
      https.get = this.originalHttpsGet
      https.request = this.originalHttpsRequest
    } else {
      http.get = this.bindHttpMethod(this.originalHttpGet, agents.http)
      http.request = this.bindHttpMethod(this.originalHttpRequest, agents.http)
      https.get = this.bindHttpMethod(this.originalHttpsGet, agents.https)
      https.request = this.bindHttpMethod(this.originalHttpsRequest, agents.https)
    }

    for (const agent of new Set(previousAgents ? [previousAgents.http, previousAgents.https] : [])) {
      try {
        agent.destroy()
      } catch (error) {
        this.logger?.error?.('Failed to destroy proxy agent:', error)
      }
    }
  }

  // oxlint-disable-next-line typescript/no-unsafe-function-type
  private bindHttpMethod(originalMethod: Function, agent: http.Agent) {
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
          options = { ...args[1] }
          callback = args[2]
        }
      } else {
        options = { ...args[0] }
        callback = args[1]
      }

      if (url && this.proxyBypassRuleMatcher.isByPass(url.toString(), this.logger)) {
        return originalMethod(url, options, callback)
      }
      if (options.agent instanceof https.Agent) {
        // Per-request TLS option — mutating the shared proxy agent would leak
        // the caller's rejectUnauthorized to later unrelated requests.
        const tlsStance = options.agent.options.rejectUnauthorized
        if (typeof tlsStance === 'boolean') {
          ;(options as https.RequestOptions).rejectUnauthorized = tlsStance
        }
      }
      options.agent = agent
      return url ? originalMethod(url, options, callback) : originalMethod(options, callback)
    }
  }

  private setGlobalFetchProxy(endpoint: ProxyEndpoint | null): void {
    if (!endpoint) {
      setGlobalDispatcher(this.originalGlobalDispatcher)
      globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.originalSocksDispatcher
      void this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      axios.defaults.adapter = this.originalAxiosAdapter
      return
    }

    axios.defaults.adapter = 'fetch'
    if (endpoint.kind === 'http') {
      this.proxyDispatcher = new SelectiveDispatcher(
        new EnvHttpProxyAgent(),
        this.originalGlobalDispatcher,
        (origin) => this.proxyBypassRuleMatcher.isByPass(origin, this.logger),
        this.logger
      )
      setGlobalDispatcher(this.proxyDispatcher)
      return
    }

    this.proxyDispatcher = new SelectiveDispatcher(
      socksDispatcher({
        port: endpoint.port,
        type: endpoint.version,
        host: endpoint.host,
        userId: endpoint.userId,
        password: endpoint.password
      }),
      this.originalSocksDispatcher,
      (origin) => this.proxyBypassRuleMatcher.isByPass(origin, this.logger),
      this.logger
    )
    setGlobalDispatcher(this.proxyDispatcher)
    globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.proxyDispatcher
  }
}
