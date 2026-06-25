import axios from 'axios'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

import { type NodeProxyLogger, ProxyBypassRuleMatcher } from './bypassRules'
import {
  buildNodeProxyEnvironment,
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
  CHERRY_NODE_PROXY_RULES_ENV,
  type NodeProxyConfig,
  normalizeProxyBypassRules
} from './proxyEnv'

// This well-known symbol is used by Node.js built-in undici to store the global dispatcher.
// Derived from undici (bundled with Node 22). If undici changes this symbol name in a future
// Node.js release, SOCKS dispatcher save/restore will silently no-op (falls back to original).
// Ref: https://github.com/nodejs/undici/blob/main/lib/global.js
const SOCKS_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const globalDispatcherRegistry = globalThis as typeof globalThis & Record<symbol, Dispatcher | undefined>

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
    // Only the proxy dispatcher is owned by this wrapper. The direct dispatcher
    // is a snapshot of the original global dispatcher and must remain intact so
    // NodeProxyController can restore it when proxying is disabled.
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
  private currentConfigKey: string | null = null
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

  configure(config: NodeProxyConfig): void {
    const proxyUrl = config.proxyRules?.trim()
    const normalizedByPassRules = normalizeProxyBypassRules(config.proxyBypassRules)
    const configKey = JSON.stringify({
      proxyUrl: proxyUrl ?? null,
      proxyByPassRules: normalizedByPassRules
    })

    if (this.currentConfigKey === configKey) {
      return
    }

    this.proxyBypassRuleMatcher.updateByPassRules(normalizedByPassRules, this.logger)
    this.setEnvironment(proxyUrl, normalizedByPassRules)
    this.setGlobalFetchProxy(proxyUrl)
    this.setGlobalHttpProxy(proxyUrl)
    this.currentConfigKey = configKey
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
      proxyBypassRules: normalizedByPassRules
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

      if (url && this.proxyBypassRuleMatcher.isByPass(url.toString(), this.logger)) {
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

    let url: URL
    try {
      url = new URL(proxyUrl)
    } catch {
      this.logger?.error?.(`Invalid proxy URL: ${proxyUrl}`)
      return
    }

    axios.defaults.adapter = 'fetch'

    if (url.protocol === 'http:' || url.protocol === 'https:') {
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
        port: parseInt(url.port),
        type: url.protocol === 'socks4:' ? 4 : 5,
        host: url.hostname,
        userId: url.username || undefined,
        password: url.password || undefined
      }),
      this.originalSocksDispatcher,
      (origin) => this.proxyBypassRuleMatcher.isByPass(origin, this.logger),
      this.logger
    )
    setGlobalDispatcher(this.proxyDispatcher)
    globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.proxyDispatcher
  }
}
