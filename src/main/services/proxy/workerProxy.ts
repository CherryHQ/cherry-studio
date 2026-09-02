import type * as NodeModule from 'node:module'

import type * as FetchSocks from 'fetch-socks'
import type * as Ipaddr from 'ipaddr.js'
import type * as Undici from 'undici'

import type { ProxyBypassMatcherFactory } from './bypassRules'
import type { ProxyRoutingSnapshot } from './proxyRouting'

export type WorkerProxyConfiguration =
  | { status: 'direct' }
  | { status: 'configured'; proxyOrigin: string; bypassRuleCount: number }
  | { status: 'failed'; error: string }

/**
 * Install worker-local dispatchers inside an isolated Node runtime from the routing policy
 * resolved by ProxyService — the single proxy authority; this function only applies the
 * snapshot it is handed and re-derives no policy of its own.
 *
 * Called by the inference utility-process entries with the snapshot from their connect frame
 * (see `ai/localModel/runtime/utilityEntries/inferenceRuntime.ts`).
 *
 * Runtime dependencies are `require`d in-body via `createRequire` off `appPath` (the host app
 * root; falls back to `process.cwd()`) rather than statically imported, so a bundled child
 * resolves undici and its transitive proxy agents exactly where the packaged app has them.
 *
 * Update contract: snapshots are immutable. A consumer records `snapshot.version`, re-fetches
 * via `ProxyService.getRoutingSnapshot()` before reusing its runtime, and restarts the runtime
 * when the version changed (see `InferenceServiceBase.restartIfRuntimeChanged()`).
 *
 * The bypass check runs per dispatch rather than against a table of known origins, because
 * undici re-enters `dispatch()` with the new origin on every redirect hop — and model
 * downloads redirect to a CDN on a different registrable domain (`huggingface.co` ->
 * `us.aws.cdn.hf.co`). Deciding routes ahead of time can only cover the first hop, so the
 * rest would be forced through the proxy even when the user's rules exempt them. This
 * mirrors NodeProxyController's own SelectiveDispatcher, sharing one matcher source.
 */
export function configureWorkerProxy(
  appPath: string | undefined,
  routing: ProxyRoutingSnapshot,
  createBypassMatcher: ProxyBypassMatcherFactory
): WorkerProxyConfiguration {
  if (routing.mode === 'direct') return { status: 'direct' }

  try {
    const proxyRouting = routing
    const { createRequire } = require('node:module') as typeof NodeModule
    const projectRequire = createRequire((appPath || process.cwd()) + '/')
    const { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = projectRequire(
      'undici'
    ) as typeof Undici

    const proxyDispatcher: Undici.Dispatcher =
      proxyRouting.endpoint.kind === 'http'
        ? new ProxyAgent(proxyRouting.endpoint.url)
        : (projectRequire('fetch-socks') as typeof FetchSocks).socksDispatcher({
            type: proxyRouting.endpoint.version,
            host: proxyRouting.endpoint.host,
            port: proxyRouting.endpoint.port,
            userId: proxyRouting.endpoint.userId,
            password: proxyRouting.endpoint.password
          })

    if (proxyRouting.bypassRules.length === 0) {
      setGlobalDispatcher(proxyDispatcher)
      return { status: 'configured', proxyOrigin: proxyRouting.endpoint.displayOrigin, bypassRuleCount: 0 }
    }

    // ipaddr.js is resolved from the app root: the worker source is an eval'd string and
    // carries no bundled dependencies of its own.
    const matcher = createBypassMatcher(projectRequire('ipaddr.js') as typeof Ipaddr, proxyRouting.bypassRules)
    const directDispatcher = getGlobalDispatcher()
    class SelectiveWorkerDispatcher extends Dispatcher {
      override dispatch(opts: Undici.Dispatcher.DispatchOptions, handler: Undici.Dispatcher.DispatchHandlers) {
        const target = opts.origin ? String(opts.origin) : ''
        return target && matcher.isByPass(target)
          ? directDispatcher.dispatch(opts, handler)
          : proxyDispatcher.dispatch(opts, handler)
      }
    }
    setGlobalDispatcher(new SelectiveWorkerDispatcher())
    return {
      status: 'configured',
      proxyOrigin: proxyRouting.endpoint.displayOrigin,
      bypassRuleCount: proxyRouting.bypassRules.length
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
