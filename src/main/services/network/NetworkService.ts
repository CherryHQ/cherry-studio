import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { EndpointDiagnosis, NetworkLayerResult, ProxyInUse } from '@shared/types/network'
import { net, session } from 'electron'

import { builtinEndpoints, type NetworkEndpoint } from './endpoints'
import { httpReach, resolveHost, tlsHandshake } from './probes'

const ONLINE_POLL_MS = 30_000
const SKIPPED: NetworkLayerResult<never> = { status: 'skipped', durationMs: 0 }

function proxyHost(effective: string): string | null {
  // Chromium PAC-style: `PROXY host:port; DIRECT` — take the first proxy entry.
  const first = effective.split(';')[0]?.trim()
  const match = /^(?:PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([^:\s]+)/i.exec(first ?? '')
  return match?.[1] ?? null
}

/**
 * Network state and probes for the whole app: online/offline (published on the shared
 * cache key `network.online`), the proxy actually in use, and layered reachability of
 * an endpoint. Consumers: System Doctor, the assistant's diagnose tool, proxy settings.
 */
@Injectable('NetworkService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProxyService'])
export class NetworkService extends BaseService {
  private online = true

  protected onReady(): void {
    // Electron exposes no main-process online/offline event, so poll and publish transitions.
    this.refreshOnline()
    this.registerInterval(() => this.refreshOnline(), ONLINE_POLL_MS)
  }

  isOnline(): boolean {
    return this.online
  }

  builtinEndpoints(): readonly NetworkEndpoint[] {
    return builtinEndpoints()
  }

  async effectiveProxy(url: string): Promise<ProxyInUse> {
    const [effective, snapshot] = await Promise.all([
      session.defaultSession.resolveProxy(url),
      application.get('ProxyService').getAppliedSnapshot()
    ])
    let mismatch: ProxyInUse['mismatch']
    if (snapshot.mode === 'custom' && !snapshot.configuredUrl) mismatch = 'custom_without_url'
    else if (snapshot.mode === 'system' && snapshot.systemProxyReadFailed) mismatch = 'system_read_failed'
    else if (snapshot.mode === 'none' && effective !== 'DIRECT') mismatch = 'system_proxy_ignored'
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
        ? { ...SKIPPED, skippedBecause: 'dns_failed' as const }
        : viaProxy
          ? { ...SKIPPED, skippedBecause: 'proxy_in_use' as const }
          : target.protocol !== 'https:'
            ? { ...SKIPPED, skippedBecause: 'not_https' as const }
            : await tlsHandshake(target.hostname, Number(target.port) || 443, signal)
    const http =
      dns.status !== 'ok'
        ? { ...SKIPPED, skippedBecause: 'dns_failed' as const }
        : await httpReach(endpoint.url, { method: endpoint.method, signal })
    const verdict =
      http.status === 'ok' ? (tls.status === 'failed' ? 'reachable_via_proxy_only' : 'reachable') : 'unreachable'
    return { endpointId: endpoint.id, host: target.hostname, dns, tls, proxy, http, verdict }
  }

  private refreshOnline(): void {
    const next = net.isOnline()
    if (next === this.online && application.get('CacheService').getShared('network.online') === next) return
    this.online = next
    application.get('CacheService').setShared('network.online', next)
  }
}
