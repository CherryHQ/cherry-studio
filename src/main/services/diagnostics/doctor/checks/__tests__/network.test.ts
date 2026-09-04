import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const ctx = () => ({ signal: new AbortController().signal })

const ok = (data?: unknown) => ({ status: 'ok', durationMs: 3, data })
const skipped = (why: string) => ({ status: 'skipped', durationMs: 0, skippedBecause: why })
const failed = (kind: string, code: string) => ({ status: 'failed', durationMs: 3, kind, code })
const direct = { effective: 'DIRECT', configuredMode: 'none' }
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(0)
  network.builtinEndpoints.mockReturnValue([
    { id: 'update', url: 'https://update.example' },
    { id: 'cloud', url: 'https://cloud.example' }
  ])
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) => diagnosis(id))
})

describe('network checks share one diagnosis pass', () => {
  it('probes each endpoint once for a whole run of checks', async () => {
    await Promise.all([
      checks.dnsResolution.run(ctx()),
      checks.tlsHandshake.run(ctx()),
      checks.endpointUpdate.run(ctx())
    ])
    expect(network.diagnoseEndpoint).toHaveBeenCalledTimes(2)
  })

  it('probes again after the sharing window', async () => {
    await checks.dnsResolution.run(ctx())
    vi.setSystemTime(10_000)
    await checks.dnsResolution.run(ctx())
    expect(network.diagnoseEndpoint).toHaveBeenCalledTimes(4)
  })
})

describe('network-dns-resolution', () => {
  it('fails naming the unresolved hosts', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(id, id === 'cloud' ? { dns: failed('dns', 'ENOTFOUND') } : {})
    )
    await expect(checks.dnsResolution.run(ctx())).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'unresolved', params: { count: 1 } },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    })
  })

  it('passes with the via_proxy variant when a proxy is in effect', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(id, { proxy: { effective: 'PROXY p:1', configuredMode: 'custom' } })
    )
    await expect(checks.dnsResolution.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'via_proxy' }
    })
  })
})

describe('network-tls-handshake', () => {
  it('reports a certificate problem with the issuer and asks to report', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(
        id,
        id === 'update'
          ? { tls: { ...failed('tls_cert', 'ERR_CERT_AUTHORITY_INVALID'), data: { issuer: 'Corp CA', validTo: '' } } }
          : {}
      )
    )
    await expect(checks.tlsHandshake.run(ctx())).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'certificate', params: { host: 'update.example', code: 'ERR_CERT_AUTHORITY_INVALID' } },
      actions: [{ kind: 'report' }],
      evidence: expect.arrayContaining([{ key: 'issuer', value: 'Corp CA', dataClass: 'public' }])
    })
  })

  it('passes as skipped when every handshake was skipped for the proxy', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(id, { tls: skipped('proxy_in_use') })
    )
    await expect(checks.tlsHandshake.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'skipped_proxy' }
    })
  })
})

describe('network-endpoint-*', () => {
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

  it('passes with via_proxy_only when only the proxied path works', async () => {
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(id, { verdict: 'reachable_via_proxy_only' })
    )
    await expect(checks.endpointUpdate.run(ctx())).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'via_proxy_only' }
    })
  })
})

describe('network-online', () => {
  it('fails when the machine is offline', async () => {
    network.isOnline.mockReturnValue(false)
    await expect(checks.online.run(ctx())).resolves.toMatchObject({ status: 'fail', detail: { variant: 'offline' } })
  })
})
