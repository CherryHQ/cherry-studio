import type { NodeProxyLogger } from './bypassRules'
import type { NodeProxyBackend } from './NodeProxyBackend'
import {
  buildNodeProxyEnvironment,
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
  CHERRY_NODE_PROXY_RULES_ENV,
  type NodeProxyConfig,
  normalizeProxyBypassRules
} from './proxyEnv'
import { normalizeProxyEndpoint } from './proxyRouting'

const PROXY_ENV_KEYS = [
  CHERRY_NODE_PROXY_RULES_ENV,
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'grpc_proxy',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'ALL_PROXY',
  'all_proxy'
] as const

export class NodeProxyController {
  private currentConfigKey: string | null = null
  private backendPromise: Promise<NodeProxyBackend> | undefined

  constructor(private logger?: NodeProxyLogger) {}

  async configure(config: NodeProxyConfig): Promise<void> {
    const proxyUrl = config.proxyRules?.trim()
    const normalizedBypassRules = normalizeProxyBypassRules(config.proxyBypassRules)
    const configKey = JSON.stringify({ proxyUrl: proxyUrl ?? null, proxyBypassRules: normalizedBypassRules })
    if (this.currentConfigKey === configKey) return

    const proxyEndpoint = normalizeProxyEndpoint(proxyUrl)
    if (proxyEndpoint) {
      await this.getBackend().then((backend) =>
        backend.configure(proxyUrl, proxyEndpoint, normalizedBypassRules, () =>
          this.setEnvironment(proxyUrl, normalizedBypassRules)
        )
      )
    } else if (this.backendPromise) {
      await this.backendPromise.then((backend) =>
        backend.configure(undefined, null, normalizedBypassRules, () =>
          this.setEnvironment(undefined, normalizedBypassRules)
        )
      )
    } else {
      this.setEnvironment(undefined, normalizedBypassRules)
    }

    this.currentConfigKey = configKey
  }

  private getBackend(): Promise<NodeProxyBackend> {
    this.backendPromise ??= import('./NodeProxyBackend').then(
      ({ NodeProxyBackend }) => new NodeProxyBackend(this.logger)
    )
    return this.backendPromise
  }

  private setEnvironment(url: string | undefined, normalizedBypassRules: string[]): void {
    for (const key of PROXY_ENV_KEYS) delete process.env[key]
    if (!url) return

    const env = buildNodeProxyEnvironment({ proxyRules: url, proxyBypassRules: normalizedBypassRules })
    for (const [key, value] of Object.entries(env)) process.env[key] = value
  }
}
