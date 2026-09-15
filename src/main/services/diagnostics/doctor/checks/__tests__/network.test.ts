import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DoctorContext } from '../../types'

const network = vi.hoisted(() => ({
  isOnline: vi.fn(),
  builtinEndpoints: vi.fn(),
  diagnoseEndpoint: vi.fn(),
  effectiveProxy: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ NetworkService: network } as never)
})

const checks = await import('../network')

/** No memo: the run-scoped sharing itself is covered by the DoctorService tests. */
const ctx = (): DoctorContext => {
  const signal = new AbortController().signal
  return { signal, share: (_key, factory) => factory(signal) }
}

const ok = (data?: unknown) => ({ status: 'ok', durationMs: 3, data })
const skipped = (why: string) => ({ status: 'skipped', durationMs: 0, skippedBecause: why })
const failed = (kind: string, code: string, data?: unknown) => ({ status: 'failed', durationMs: 3, kind, code, data })
const direct = { effective: 'DIRECT', configuredMode: 'none' }
const ENDPOINT_IDS = ['update', 'registry', 'cloud', 'diagnostics'] as const
const diagnosis = (endpointId: string, over: Record<string, unknown> = {}) => ({
  endpointId,
  host: `${endpointId}.example`,
  dns: ok({ addresses: ['1.1.1.1'] }),
  tls: ok({ issuer: 'R3', validTo: '2027' }),
  proxy: direct,
  http: ok({ status: 200 }),
  verdict: 'reachable',
  ...over
})
/** Overrides one endpoint's diagnosis; the others stay healthy. */
const only = (target: string, over: Record<string, unknown>) =>
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
    diagnosis(id, id === target ? over : {})
  )
const every = (over: Record<string, unknown>) =>
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) => diagnosis(id, over))

beforeEach(() => {
  vi.clearAllMocks()
  network.builtinEndpoints.mockReturnValue(ENDPOINT_IDS.map((id) => ({ id, url: `https://${id}.example` })))
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) => diagnosis(id))
  network.effectiveProxy.mockResolvedValue(direct)
})

describe('network-dns-resolution', () => {
  it('fails with the count of unresolved hosts, keeping the hosts out of the params', async () => {
    only('cloud', { dns: failed('dns', 'ENOTFOUND') })
    const result = await checks.dnsResolution.run(ctx())
    expect(result).toMatchObject({
      status: 'fail',
      detail: { variant: 'unresolved', params: { count: 1 } },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    })
    expect(JSON.stringify(result.detail)).not.toContain('cloud.example')
    expect(result.evidence).toContainEqual({ key: 'cloud:cloud.example', value: 'ENOTFOUND', dataClass: 'local_only' })
  })

  it('reports no_response when every failure is a timeout', async () => {
    every({ dns: failed('timeout', 'TimeoutError') })
    await expect(checks.dnsResolution.run(ctx())).resolves.toMatchObject({ detail: { variant: 'no_response' } })
  })

  it('passes with the via_proxy variant when a proxy is in effect', async () => {
    every({ proxy: { effective: 'PROXY p:1', configuredMode: 'custom' } })
    await expect(checks.dnsResolution.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'via_proxy' }
    })
  })
})

describe('network-tls-handshake', () => {
  it('reports a rejected certificate with its issuer as local-only evidence and asks to report', async () => {
    only('update', {
      tls: failed('tls_cert', 'ERR_CERT_AUTHORITY_INVALID', { issuer: 'Corp CA', validTo: '' })
    })
    const result = await checks.tlsHandshake.run(ctx())
    expect(result).toMatchObject({
      status: 'fail',
      detail: { variant: 'certificate', params: { code: 'ERR_CERT_AUTHORITY_INVALID' } },
      actions: [{ kind: 'report' }]
    })
    expect(result.evidence).toContainEqual({ key: 'issuer', value: 'Corp CA', dataClass: 'local_only' })
    expect(JSON.stringify(result.detail)).not.toContain('update.example')
  })

  it('reports non-certificate handshake failures as unreachable with a count', async () => {
    only('cloud', { tls: failed('refused', 'ECONNREFUSED') })
    await expect(checks.tlsHandshake.run(ctx())).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'unreachable', params: { count: 1 } }
    })
  })

  it('passes as skipped when every handshake was skipped for the proxy', async () => {
    every({ tls: skipped('proxy_in_use') })
    await expect(checks.tlsHandshake.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'skipped_proxy' }
    })
  })
})

describe('network-proxy-applied', () => {
  it('reads the proxy for the first built-in endpoint without probing anything', async () => {
    await expect(checks.proxyApplied.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'direct' }
    })
    expect(network.effectiveProxy).toHaveBeenCalledWith('https://update.example')
    expect(network.diagnoseEndpoint).not.toHaveBeenCalled()
  })

  it('warns when the configured proxy could not be applied', async () => {
    network.effectiveProxy.mockResolvedValue({
      effective: 'DIRECT',
      configuredMode: 'custom',
      mismatch: 'apply_failed'
    })
    await expect(checks.proxyApplied.run(ctx())).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'apply_failed' },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    })
  })
})

describe('network-endpoint-*', () => {
  it.each([
    ['update', checks.endpointUpdate],
    ['registry', checks.endpointRegistry],
    ['cloud', checks.endpointCloud],
    ['diagnostics', checks.endpointDiagnostics]
  ] as const)('%s reports its own endpoint only', async (id, check) => {
    only(id, { http: failed('timeout', 'ERR_TIMED_OUT'), verdict: 'unreachable' })
    const result = await check.run(ctx())
    expect(result).toMatchObject({ status: 'fail', detail: { variant: 'timeout', params: { code: 'ERR_TIMED_OUT' } } })
    expect(JSON.stringify(result.detail)).not.toContain(`${id}.example`)
    for (const other of ENDPOINT_IDS.filter((o) => o !== id)) {
      only(other, { http: failed('timeout', 'ERR_TIMED_OUT'), verdict: 'unreachable' })
      await expect(check.run(ctx())).resolves.toMatchObject({ status: 'pass' })
    }
  })

  it('maps a 407 to proxy_auth and a 5xx to a transient server_error warning', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(
        id,
        id === 'update'
          ? { http: failed('proxy_auth', 'HTTP 407'), verdict: 'unreachable' }
          : { http: failed('http_server', 'HTTP 503'), verdict: 'unreachable' }
      )
    )
    await expect(checks.endpointUpdate.run(ctx())).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'proxy_auth' }
    })
    await expect(checks.endpointCloud.run(ctx())).resolves.toMatchObject({
      status: 'warn',
      attribution: 'transient',
      detail: { variant: 'server_error' }
    })
  })

  it('passes with untrusted_tls when HTTP got through but the direct handshake was rejected', async () => {
    every({ verdict: 'reachable_untrusted_tls' })
    await expect(checks.endpointUpdate.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'untrusted_tls' }
    })
  })
})

describe('network-online', () => {
  it('fails when the machine is offline', async () => {
    network.isOnline.mockReturnValue(false)
    await expect(checks.online.run(ctx())).resolves.toMatchObject({ status: 'fail', detail: { variant: 'offline' } })
  })
})
