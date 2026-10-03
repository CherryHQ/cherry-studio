import { socksConnector } from 'fetch-socks'
import { Agent, type Dispatcher, Pool, ProxyAgent } from 'undici'

import type { ResolvedRemoteFetchUrl } from '@main/utils/remoteUrlSafety'

import { ProxyBypassRuleMatcher } from './bypassRules'
import { CHERRY_NODE_PROXY_BYPASS_RULES_ENV, CHERRY_NODE_PROXY_RULES_ENV, normalizeProxyBypassRules } from './proxyEnv'
import { normalizeProxyEndpoint } from './proxyRouting'

/** Creates a request-owned dispatcher; the caller must destroy it after consuming the response. */
export function createPinnedDispatcher(target: ResolvedRemoteFetchUrl): Dispatcher {
  const bypass = new ProxyBypassRuleMatcher()
  bypass.updateByPassRules(normalizeProxyBypassRules(process.env[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]))
  const proxy = bypass.isByPass(target.url) ? null : normalizeProxyEndpoint(process.env[CHERRY_NODE_PROXY_RULES_ENV])

  if (proxy?.kind === 'http') {
    const url = new URL(target.url)
    const host = target.address.family === 6 ? `[${target.address.address}]` : target.address.address
    const authority = `${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
    return new ProxyAgent({
      uri: proxy.url,
      proxyTunnel: true,
      clientFactory: (origin, options) =>
        new Pool(origin, options).compose(
          (dispatch) => (opts, handler) =>
            dispatch(
              {
                ...opts,
                path: authority,
                headers: { ...(opts.headers as Record<string, string>), host: authority }
              },
              handler
            )
        )
    })
  }

  if (proxy?.kind === 'socks') {
    const connect = socksConnector({
      host: proxy.host,
      port: proxy.port,
      type: proxy.version,
      userId: proxy.userId,
      password: proxy.password
    })
    return new Agent({
      connect: (options, callback) => connect({ ...options, hostname: target.address.address }, callback)
    })
  }

  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, [target.address])
        else callback(null, target.address.address, target.address.family)
      }
    }
  })
}
