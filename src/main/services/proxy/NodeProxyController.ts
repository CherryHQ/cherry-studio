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
    // `<-loopback>` is the Chromium directive that cancels the implicit loopback bypass. The Node
    // stack has no implicit bypass of its own — the loopback entries below ARE its scope — so the
    // directive is consumed here: it is stripped and the defaults are skipped, leaving loopback
    // traffic to follow the configured proxy exactly as the directive requests.
    const loopbackEscape = normalizedBypassRules.includes('<-loopback>')
    const scopedBypassRules = loopbackEscape
      ? normalizedBypassRules.filter((hostname) => hostname !== '<-loopback>')
      : normalizedBypassRules
    // Keep local services reachable independently of the configured proxy.
    if (proxyUrl && !loopbackEscape) {
      for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]']) {
        if (!scopedBypassRules.includes(hostname)) scopedBypassRules.push(hostname)
      }
    }
    const configKey = JSON.stringify({ proxyUrl: proxyUrl ?? null, proxyBypassRules: scopedBypassRules })
    if (this.currentConfigKey === configKey) return

    const proxyEndpoint = normalizeProxyEndpoint(proxyUrl)
    if (proxyEndpoint) {
      await this.getBackend().then((backend) =>
        backend.configure(proxyUrl, proxyEndpoint, scopedBypassRules, () =>
          this.setEnvironment(proxyUrl, scopedBypassRules)
        )
      )
    } else if (this.backendPromise) {
      await this.backendPromise.then((backend) =>
        backend.configure(undefined, null, scopedBypassRules, () => this.setEnvironment(undefined, scopedBypassRules))
      )
    } else {
      this.setEnvironment(undefined, scopedBypassRules)
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
