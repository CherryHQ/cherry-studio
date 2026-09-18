import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { DOCTOR_CHECK_CATALOG, type DoctorCheckId } from '@shared/types/doctor'

import { runDoctorChecks } from '../../engine'
import type { DoctorContextBase, DoctorProbeOutcome } from '../../types'

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
const { providerModel } = await import('../provider')
const dbh = setupTestDatabase()

/** No memo: the run-scoped sharing itself is covered by the DoctorService tests. */
const ctx = (): DoctorContextBase => {
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
  network.isOnline.mockReturnValue(true)
  network.builtinEndpoints.mockResolvedValue(ENDPOINT_IDS.map((id) => ({ id, url: `https://${id}.example` })))
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) => diagnosis(id))
  network.effectiveProxy.mockResolvedValue(direct)
})

describe('network-dns-resolution', () => {
  it('fails with the count of unresolved hosts, keeping the hosts out of the params', async () => {
    only('cloud', { dns: failed('dns', 'ENOTFOUND') })
    const result = await checks.dnsResolution.run({ ...ctx(), subject: null })
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
    await expect(checks.dnsResolution.run({ ...ctx(), subject: null })).resolves.toMatchObject({
      detail: { variant: 'no_response' }
    })
  })

  it('passes with the via_proxy variant when a proxy is in effect', async () => {
    every({ proxy: { effective: 'PROXY p:1', configuredMode: 'custom' } })
    await expect(checks.dnsResolution.run({ ...ctx(), subject: null })).resolves.toMatchObject({
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
    const result = await checks.tlsHandshake.run({ ...ctx(), subject: null })
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
    await expect(checks.tlsHandshake.run({ ...ctx(), subject: null })).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'unreachable', params: { count: 1 } }
    })
  })

  it('passes as skipped when every handshake was skipped for the proxy', async () => {
    every({ tls: skipped('proxy_in_use') })
    await expect(checks.tlsHandshake.run({ ...ctx(), subject: null })).resolves.toMatchObject({
      status: 'pass',
      detail: { variant: 'skipped_proxy' }
    })
  })
})

describe('network-proxy-applied', () => {
  it('warns when the configured proxy could not be applied', async () => {
    every({
      proxy: {
        effective: 'DIRECT',
        configuredMode: 'custom',
        mismatch: 'apply_failed'
      }
    })
    await expect(checks.proxyApplied.run({ ...ctx(), subject: null })).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'apply_failed' },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    })
  })
})

describe('network-endpoint-*', () => {
  it('reports healthy endpoints even when another host fails DNS', async () => {
    only('cloud', { dns: failed('dns', 'ENOTFOUND'), http: skipped('dns_failed'), verdict: 'unreachable' })
    const results = await runDoctorChecks<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>({
      checks: [checks.online, checks.dnsResolution, checks.endpointUpdate, checks.endpointCloud].map((check) => ({
        id: check.id,
        requires: DOCTOR_CHECK_CATALOG[check.id].requires,
        timeoutMs: 1000,
        lane: 'live',
        run: () => (check.id === 'network-dns-resolution' ? check.run({ ...ctx(), subject: null }) : check.run(ctx()))
      }))
    })
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'network-dns-resolution', status: 'fail' }),
        expect.objectContaining({ id: 'network-endpoint-update', status: 'pass' }),
        expect.objectContaining({ id: 'network-endpoint-cloud', status: 'fail' })
      ])
    )
  })

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

describe('network-provider-endpoint', () => {
  it.each([
    ['dns', 'ENOTFOUND', '/settings/provider'],
    ['refused', 'ECONNREFUSED', '/settings/provider'],
    ['timeout', 'ERR_TIMED_OUT', '/settings/provider'],
    ['proxy_auth', 'HTTP 407', '/settings/general'],
    ['proxy_unreachable', 'ERR_PROXY_CONNECTION_FAILED', '/settings/general']
  ])('routes %s failures to the settings that own the problem', async (kind, code, target) => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'openai',
        name: 'OpenAI',
        orderKey: 'a0',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.example' } }
      })
      .run()
    every({ http: failed(kind, code), verdict: 'unreachable' })

    await expect(checks.providerEndpoint.run({ ...ctx(), subject: { providerId: 'openai' } })).resolves.toMatchObject({
      status: 'fail',
      actions: [{ kind: 'navigate', target }]
    })
  })

  it("probes the subject provider's chat base URL and reports its HTTP verdict", async () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'openai',
        name: 'OpenAI',
        orderKey: 'a0',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'api.openai.com/v1' } }
      })
      .run()
    network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
      diagnosis(id, { http: failed('refused', 'ECONNREFUSED') })
    )

    await expect(checks.providerEndpoint.run({ ...ctx(), subject: { providerId: 'openai' } })).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'unreachable', params: { code: 'ECONNREFUSED' } }
    })
    expect(network.diagnoseEndpoint).toHaveBeenCalledWith(
      { id: 'provider:openai', url: 'https://api.openai.com/v1' },
      expect.any(AbortSignal)
    )
  })

  it('passes without probing when the provider has no base URL to reach', async () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'vertex', name: 'Vertex', orderKey: 'a0', endpointConfigs: {} })
      .run()

    await expect(checks.providerEndpoint.run({ ...ctx(), subject: { providerId: 'vertex' } })).resolves.toEqual({
      status: 'pass'
    })
    expect(network.diagnoseEndpoint).not.toHaveBeenCalled()
  })
})

// A failed app-update host must not become the diagnosis of a reachable chat provider.
it('uses the chat provider for DNS, TLS and proxy checks instead of built-in hosts', async () => {
  dbh.db
    .insert(userProviderTable)
    .values({
      providerId: 'openai',
      name: 'OpenAI',
      orderKey: 'a0',
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.example' } }
    })
    .run()
  network.builtinEndpoints.mockReturnValue([{ id: 'update', url: 'https://unrelated.invalid' }])
  network.diagnoseEndpoint.mockImplementation(async ({ id }: { id: string }) =>
    diagnosis(
      id,
      id === 'update'
        ? { dns: failed('dns', 'ENOTFOUND') }
        : { proxy: { effective: 'PROXY chat-proxy:80', configuredMode: 'system' } }
    )
  )
  const context = { ...ctx(), subject: { providerId: 'openai' } }
  await expect(checks.dnsResolution.run(context)).resolves.toMatchObject({
    status: 'pass',
    detail: { variant: 'via_proxy' }
  })
  await expect(checks.tlsHandshake.run(context)).resolves.toMatchObject({ status: 'pass' })
  await expect(checks.proxyApplied.run(context)).resolves.toMatchObject({
    status: 'pass',
    detail: { variant: 'proxy' }
  })
  expect(network.diagnoseEndpoint).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'provider:openai', url: expect.stringContaining('api.openai.example') }),
    expect.any(AbortSignal)
  )
  expect(network.builtinEndpoints).not.toHaveBeenCalled()
})

it('skips contextual network probes for a deleted provider while global network checks still run', async () => {
  dbh.db.insert(userProviderTable).values({ providerId: 'deleted', name: 'Deleted', orderKey: 'a0' }).run()
  dbh.db.delete(userProviderTable).run()
  network.isOnline.mockReturnValue(true)
  const context = { ...ctx(), subject: { providerId: 'deleted', modelId: 'model' } }
  const definitions = [
    providerModel,
    checks.online,
    checks.dnsResolution,
    checks.tlsHandshake,
    checks.proxyApplied,
    checks.providerEndpoint
  ]
  const results = await runDoctorChecks<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>({
    checks: definitions.map((definition) => ({
      id: definition.id,
      run: () => (definition.id === 'network-online' ? definition.run(ctx()) : definition.run(context)),
      requires: DOCTOR_CHECK_CATALOG[definition.id].requires,
      lane: 'live',
      timeoutMs: 1_000
    }))
  })
  expect(results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'provider-model', status: 'fail', detail: { variant: 'provider_unavailable' } }),
      expect.objectContaining({
        id: 'network-dns-resolution',
        status: 'skip',
        detail: { variant: 'provider_unavailable' }
      }),
      expect.objectContaining({
        id: 'network-proxy-applied',
        status: 'skip',
        detail: { variant: 'provider_unavailable' }
      }),
      expect.objectContaining({ id: 'network-tls-handshake', status: 'skip', skippedBy: 'network-dns-resolution' }),
      expect.objectContaining({ id: 'network-provider-endpoint', status: 'skip', skippedBy: 'provider-model' })
    ])
  )
  expect(network.diagnoseEndpoint).not.toHaveBeenCalled()
  for (const check of [checks.dnsResolution, checks.tlsHandshake, checks.proxyApplied]) {
    await expect(check.run(context)).resolves.toEqual({ status: 'skip', detail: { variant: 'provider_unavailable' } })
    await expect(check.run({ ...ctx(), subject: null })).resolves.toMatchObject({ status: 'pass' })
  }
})

it('keeps a reachable cloud check running when the unrelated update host cannot resolve', async () => {
  network.isOnline.mockReturnValue(true)
  only('update', { dns: failed('dns', 'ENOTFOUND'), http: skipped('dns_failed') })
  const definitions = [
    { id: 'network-online' as const, run: () => checks.online.run(ctx()) },
    { id: 'network-dns-resolution' as const, run: () => checks.dnsResolution.run({ ...ctx(), subject: null }) },
    { id: 'network-endpoint-cloud' as const, run: () => checks.endpointCloud.run(ctx()) }
  ]
  const results = await runDoctorChecks<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>({
    checks: definitions.map((definition) => ({
      ...definition,
      requires: DOCTOR_CHECK_CATALOG[definition.id].requires,
      lane: 'live',
      timeoutMs: 1_000
    }))
  })
  expect(results.find(({ id }) => id === 'network-dns-resolution')?.status).toBe('fail')
  expect(results.find(({ id }) => id === 'network-endpoint-cloud')?.status).toBe('pass')
})
