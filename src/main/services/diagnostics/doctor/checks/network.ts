import { application } from '@application'
import type {
  EndpointDiagnosis,
  NetworkEndpointId,
  NetworkFailureKind,
  NetworkLayerResult
} from '@main/services/network'
import type { DoctorCheckId, DoctorEvidenceItem } from '@shared/types/doctor'

import { defineDoctorCheck, type DoctorContext, type DoctorProbeOutcome } from '../types'

/** One diagnosis pass per run: every network check reads it instead of resolving the same hosts again. */
function diagnoseAll(ctx: DoctorContext): Promise<readonly EndpointDiagnosis[]> {
  return ctx.share('network:diagnoses', (signal) => {
    const network = application.get('NetworkService')
    return Promise.all(network.builtinEndpoints().map((endpoint) => network.diagnoseEndpoint(endpoint, signal)))
  })
}

function layerValue(result: NetworkLayerResult<unknown>): string {
  if (result.status === 'ok') return `ok ${Math.round(result.durationMs)}ms`
  if (result.status === 'failed') return result.code ?? result.kind
  return `skipped (${result.skippedBecause})`
}

const layerEvidence = (diagnoses: readonly EndpointDiagnosis[], layer: 'dns' | 'tls' | 'http'): DoctorEvidenceItem[] =>
  diagnoses.map((d) => ({ key: `${d.endpointId}:${d.host}`, value: layerValue(d[layer]), dataClass: 'local_only' }))

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
    const slow = failing.every((d) => d.dns.status === 'failed' && d.dns.kind === 'timeout')
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
    const cert = diagnoses.find((d) => d.tls.status === 'failed' && d.tls.kind === 'tls_cert')
    if (cert?.tls.status === 'failed') {
      const issuer = cert.tls.data?.issuer
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'certificate', params: { code: cert.tls.code ?? '' } },
        actions: [REPORT],
        devMessage: `TLS certificate rejected for ${cert.host}: ${cert.tls.code}`,
        evidence: [...evidence, ...(issuer ? [{ key: 'issuer', value: issuer, dataClass: 'local_only' as const }] : [])]
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
  async run(): Promise<DoctorProbeOutcome<'network-proxy-applied'>> {
    const network = application.get('NetworkService')
    const proxy = await network.effectiveProxy(network.builtinEndpoints()[0].url)
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

function endpointCheck<Id extends Extract<DoctorCheckId, `network-endpoint-${string}`>>(
  id: Id,
  endpointId: NetworkEndpointId
) {
  return defineDoctorCheck({
    id,
    async run(ctx): Promise<DoctorProbeOutcome<Id>> {
      const diagnosis = (await diagnoseAll(ctx)).find((d) => d.endpointId === endpointId)
      if (!diagnosis) throw new Error(`Endpoint "${endpointId}" was not probed`)
      const evidence = layerEvidence([diagnosis], 'http')
      if (diagnosis.http.status === 'ok') {
        return {
          status: 'pass',
          detail: { variant: diagnosis.verdict === 'reachable_untrusted_tls' ? 'untrusted_tls' : 'reachable' },
          evidence
        }
      }
      const failure = diagnosis.http.status === 'failed' ? diagnosis.http : undefined
      const variant = (failure && HTTP_VARIANT[failure.kind]) ?? 'unreachable'
      return {
        status: variant === 'server_error' ? 'warn' : 'fail',
        attribution: variant === 'server_error' ? 'transient' : 'user-fixable',
        detail: { variant, params: { code: failure?.code ?? '' } },
        actions: [NAVIGATE_PROXY],
        devMessage: `${endpointId} (${diagnosis.host}) ${failure?.kind ?? 'skipped'}: ${failure?.code}`,
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
