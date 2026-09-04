import { application } from '@application'
import type { DoctorCheckId, DoctorEvidenceItem } from '@shared/types/doctor'
import type { EndpointDiagnosis, NetworkFailureKind, NetworkLayerResult } from '@shared/types/network'

import { defineDoctorCheck, type DoctorContext, type DoctorProbeOutcome } from '../types'

/**
 * One diagnosis pass feeds every network check of a run: all callers within a short window
 * share the same in-flight promise instead of resolving the same hosts eight times.
 */
let inflight: { readonly at: number; readonly promise: Promise<readonly EndpointDiagnosis[]> } | null = null
const SHARE_WINDOW_MS = 5_000

function diagnoseAll(ctx: DoctorContext): Promise<readonly EndpointDiagnosis[]> {
  if (inflight && Date.now() - inflight.at < SHARE_WINDOW_MS) return inflight.promise
  const network = application.get('NetworkService')
  const promise = Promise.all(
    network.builtinEndpoints().map((endpoint) => network.diagnoseEndpoint(endpoint, ctx.signal))
  )
  inflight = { at: Date.now(), promise }
  promise.finally(() => {
    if (inflight?.promise === promise) inflight = null
  })
  return promise
}

const layerEvidence = (diagnoses: readonly EndpointDiagnosis[], layer: 'dns' | 'tls' | 'http'): DoctorEvidenceItem[] =>
  diagnoses.map((d) => {
    const result: NetworkLayerResult<unknown> = d[layer]
    const value = result.status === 'ok' ? `ok ${Math.round(result.durationMs)}ms` : (result.code ?? result.status)
    return { key: `${d.endpointId}:${d.host}`, value, dataClass: 'local_only' }
  })

const NAVIGATE_PROXY = { kind: 'navigate', target: '/settings/general' } as const
const REPORT = { kind: 'report' } as const

export const online = defineDoctorCheck({
  id: 'network-online',
  async run() {
    if (application.get('NetworkService').isOnline()) return { status: 'pass' }
    return { status: 'fail', attribution: 'user-fixable', detail: { variant: 'offline' }, actions: [] }
  },
  fixes: {}
})

export const dnsResolution = defineDoctorCheck({
  id: 'network-dns-resolution',
  async run(ctx): Promise<DoctorProbeOutcome<'network-dns-resolution'>> {
    const diagnoses = await diagnoseAll(ctx)
    const failing = diagnoses.filter((d) => d.dns.status === 'failed')
    const evidence = layerEvidence(diagnoses, 'dns')
    if (failing.length === 0) {
      const viaProxy = diagnoses.some((d) => d.proxy.effective !== 'DIRECT')
      return { status: 'pass', detail: { variant: viaProxy ? 'via_proxy' : 'resolved' }, evidence }
    }
    const slow = failing.every((d) => d.dns.kind === 'timeout')
    return {
      status: 'fail',
      attribution: 'user-fixable',
      detail: { variant: slow ? 'no_response' : 'unresolved', params: { count: failing.length } },
      actions: [NAVIGATE_PROXY],
      devMessage: `DNS failed for ${failing.map((d) => d.host).join(', ')}`,
      evidence
    }
  },
  fixes: {}
})

export const tlsHandshake = defineDoctorCheck({
  id: 'network-tls-handshake',
  async run(ctx): Promise<DoctorProbeOutcome<'network-tls-handshake'>> {
    const diagnoses = await diagnoseAll(ctx)
    const evidence = layerEvidence(diagnoses, 'tls')
    if (diagnoses.every((d) => d.tls.status === 'skipped' && d.tls.skippedBecause === 'proxy_in_use')) {
      return { status: 'pass', detail: { variant: 'skipped_proxy' }, evidence }
    }
    const cert = diagnoses.find((d) => d.tls.kind === 'tls_cert')
    if (cert) {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'certificate', params: { host: cert.host, code: cert.tls.code ?? '' } },
        actions: [REPORT],
        devMessage: `TLS certificate rejected for ${cert.host}: ${cert.tls.code}`,
        evidence: [
          ...evidence,
          ...(cert.tls.data ? [{ key: 'issuer', value: cert.tls.data.issuer, dataClass: 'public' as const }] : [])
        ]
      }
    }
    const failing = diagnoses.filter((d) => d.tls.status === 'failed')
    if (failing.length > 0) {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'unreachable', params: { count: failing.length } },
        actions: [NAVIGATE_PROXY],
        evidence
      }
    }
    return { status: 'pass', detail: { variant: 'ok' }, evidence }
  },
  fixes: {}
})

export const proxyApplied = defineDoctorCheck({
  id: 'network-proxy-applied',
  async run(ctx): Promise<DoctorProbeOutcome<'network-proxy-applied'>> {
    const [first] = await diagnoseAll(ctx)
    const proxy = first?.proxy ?? (await application.get('NetworkService').effectiveProxy('https://cherry-ai.com'))
    const evidence: DoctorEvidenceItem[] = [
      { key: 'effective', value: proxy.effective, dataClass: 'local_only' },
      { key: 'configuredMode', value: proxy.configuredMode, dataClass: 'public' }
    ]
    if (proxy.mismatch) {
      return {
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: proxy.mismatch },
        actions: [NAVIGATE_PROXY],
        evidence
      }
    }
    return { status: 'pass', detail: { variant: proxy.effective === 'DIRECT' ? 'direct' : 'proxy' }, evidence }
  },
  fixes: {}
})

const HTTP_VARIANT: Partial<Record<NetworkFailureKind, 'proxy_auth' | 'server_error' | 'timeout'>> = {
  proxy_auth: 'proxy_auth',
  http_server: 'server_error',
  timeout: 'timeout'
}

function endpointCheck<Id extends Extract<DoctorCheckId, `network-endpoint-${string}`>>(id: Id, endpointId: string) {
  return defineDoctorCheck({
    id,
    async run(ctx): Promise<DoctorProbeOutcome<Id>> {
      const diagnosis = (await diagnoseAll(ctx)).find((d) => d.endpointId === endpointId)
      if (!diagnosis) return { status: 'pass' }
      const evidence = layerEvidence([diagnosis], 'http')
      if (diagnosis.http.status === 'ok') {
        return {
          status: 'pass',
          detail: { variant: diagnosis.verdict === 'reachable_via_proxy_only' ? 'via_proxy_only' : 'reachable' },
          evidence
        }
      }
      const variant = HTTP_VARIANT[diagnosis.http.kind ?? 'unknown'] ?? 'unreachable'
      return {
        status: variant === 'server_error' ? 'warn' : 'fail',
        attribution: variant === 'server_error' ? 'transient' : 'user-fixable',
        detail: { variant, params: { host: diagnosis.host, code: diagnosis.http.code ?? '' } },
        actions: [NAVIGATE_PROXY],
        devMessage: `${endpointId} (${diagnosis.host}) ${diagnosis.http.kind}: ${diagnosis.http.code}`,
        evidence
      }
    },
    fixes: {}
  })
}

export const endpointUpdate = endpointCheck('network-endpoint-update', 'update')
export const endpointRegistry = endpointCheck('network-endpoint-registry', 'registry')
export const endpointCloud = endpointCheck('network-endpoint-cloud', 'cloud')
export const endpointDiagnostics = endpointCheck('network-endpoint-diagnostics', 'diagnostics')
