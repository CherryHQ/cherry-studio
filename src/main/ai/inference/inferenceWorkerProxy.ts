import type * as NodeModule from 'node:module'

import type * as Undici from 'undici'

export type InferenceWorkerProxyConfiguration =
  | { status: 'direct' }
  | { status: 'configured'; proxyOrigins: string[]; bypassRulesConfigured: boolean }
  | { status: 'unsupported'; protocol: 'socks' }
  | { status: 'failed'; error: string }

/**
 * Configures HTTP(S) proxying inside the inference worker. The worker runs in a
 * separate V8 isolate, so the main process's Undici dispatcher is not inherited,
 * but it consumes the same environment prepared by NodeProxyController.
 */
export function configureInferenceWorkerProxy(appPath?: string): InferenceWorkerProxyConfiguration {
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY
  if (!httpProxy && !httpsProxy) {
    const socksProxy = process.env.socks_proxy ?? process.env.SOCKS_PROXY
    return socksProxy ? { status: 'unsupported', protocol: 'socks' } : { status: 'direct' }
  }

  try {
    const { createRequire } = require('node:module') as typeof NodeModule
    const projectRequire = createRequire((appPath || process.cwd()) + '/')
    const { EnvHttpProxyAgent, setGlobalDispatcher } = projectRequire('undici') as typeof Undici
    setGlobalDispatcher(new EnvHttpProxyAgent())

    const proxyOrigins = [
      ...new Set([httpProxy, httpsProxy].filter((url): url is string => Boolean(url)).map((url) => new URL(url).origin))
    ]
    return {
      status: 'configured',
      proxyOrigins,
      bypassRulesConfigured: Boolean(process.env.no_proxy ?? process.env.NO_PROXY)
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
