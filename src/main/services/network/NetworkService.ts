import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { net, session } from 'electron'

import { builtinEndpoints } from './endpoints'
import { httpReach, resolveHost, tlsHandshake } from './probes'
import type { EndpointDiagnosis, NetworkEndpoint, NetworkLayerResult, ProxyInUse } from './types'

const ONLINE_POLL_MS = 30_000
const skipped = (skippedBecause: 'proxy_in_use' | 'dns_failed' | 'not_https'): NetworkLayerResult<never> => ({
  status: 'skipped',
  durationMs: 0,
  skippedBecause
})

function proxyHost(effective: string): string | null {
  // Chromium PAC-style: `PROXY host:port; DIRECT` — take the first proxy entry; IPv6 hosts are bracketed.
  const first = effective.split(';')[0]?.trim()
  const match = /^(?:PROXY|HTTPS|SOCKS5?|SOCKS4)\s+(\[[^\]]+\]|[^:\s]+)/i.exec(first ?? '')
  return match?.[1].replace(/^\[|\]$/g, '') ?? null
}

/**
 * Network state and probes for the whole app: online/offline (published on the shared
 * cache key `network.online`), the proxy actually in use, and layered reachability of
 * an endpoint. System Doctor is the first consumer.
 */
@Injectable('NetworkService')
@ServicePhase(Phase.WhenReady)
export class NetworkService extends BaseService {
  private online = true

  protected onReady(): void {
    // Electron exposes no main-process online/offline event, so poll and publish transitions.
    this.isOnline()
    this.registerInterval(() => {
      this.isOnline()
    }, ONLINE_POLL_MS)
  }

  /** Reads through so a check never answers from a stale poll; publishes the transition if any. */
  isOnline(): boolean {
    const next = net.isOnline()
    if (next !== this.online || application.get('CacheService').getShared('network.online') !== next) {
      this.online = next
      application.get('CacheService').setShared('network.online', next)
    }
    return next
  }

  builtinEndpoints(): readonly NetworkEndpoint[] {
    return builtinEndpoints()
  }

  async effectiveProxy(url: string): Promise<ProxyInUse> {
    const snapshot = await application.get('ProxyService').getAppliedSnapshot()
    const effective = await session.defaultSession.resolveProxy(url)
    let mismatch: ProxyInUse['mismatch']
    if (!snapshot.converged) mismatch = 'apply_failed'
    else if (snapshot.mode === 'custom' && !snapshot.hasConfiguredUrl) mismatch = 'custom_without_url'
    else if (snapshot.mode === 'system' && snapshot.systemProxyReadFailed) mismatch = 'system_read_failed'
    return { effective, configuredMode: snapshot.mode, mismatch }
  }

  /**
   * DNS → TLS → proxy → HTTP with the cascade the layers imply: behind a proxy the target's
   * DNS is the proxy's job (so the proxy host is resolved instead) and a direct TLS handshake
   * is meaningless (skipped); a failed DNS skips the rest; HTTP is the final verdict because it
   * travels the same stack as real traffic.
   */
  async diagnoseEndpoint(endpoint: NetworkEndpoint, signal: AbortSignal): Promise<EndpointDiagnosis> {
    const target = new URL(endpoint.url)
    const proxy = await this.effectiveProxy(endpoint.url)
    const viaProxy = proxyHost(proxy.effective)
    const dns = await resolveHost(viaProxy ?? target.hostname, signal)
    const tls =
      dns.status !== 'ok'
        ? skipped('dns_failed')
        : viaProxy
          ? skipped('proxy_in_use')
          : target.protocol !== 'https:'
            ? skipped('not_https')
            : await tlsHandshake(target.hostname, Number(target.port) || 443, signal)
    const http =
      dns.status !== 'ok' ? skipped('dns_failed') : await httpReach(endpoint.url, { method: endpoint.method, signal })
    const untrustedTls = tls.status === 'failed' && tls.kind === 'tls_cert'
    const verdict = http.status !== 'ok' ? 'unreachable' : untrustedTls ? 'reachable_untrusted_tls' : 'reachable'
    return { endpointId: endpoint.id, host: target.hostname, dns, tls, proxy, http, verdict }
  }
}
