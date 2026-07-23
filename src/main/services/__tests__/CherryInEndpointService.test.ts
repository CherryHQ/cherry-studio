import { BaseService } from '@main/core/lifecycle'
import { CHERRYIN_HOSTS } from '@shared/config/cherryin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  fetch: vi.fn(),
  getProvider: vi.fn(),
  updateProvider: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: vi.fn(() => ({ broadcast: mocks.broadcast })) }
}))
vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getProvider,
    update: mocks.updateProvider
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() })) }
}))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))

import { CherryInEndpointService, choosePreferredCherryInHost } from '../CherryInEndpointService'

const provider = {
  isEnabled: false,
  settings: {},
  endpointConfigs: {
    openai: { baseUrl: CHERRYIN_HOSTS.china },
    anthropic: { baseUrl: CHERRYIN_HOSTS.china }
  }
}

function response(ok = true): Response {
  return new Response(JSON.stringify({ status: ok ? 'ok' : 'down' }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' }
  })
}

describe('CherryInEndpointService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    provider.isEnabled = false
    provider.settings = {}
    mocks.getProvider.mockReturnValue(provider)
    mocks.updateProvider.mockReturnValue(provider)
  })

  it('selects by success count, then median latency, with .net fallback', () => {
    expect(
      choosePreferredCherryInHost(
        { host: CHERRYIN_HOSTS.china, latencies: [], successCount: 0 },
        { host: CHERRYIN_HOSTS.global, latencies: [], successCount: 0 }
      ).host
    ).toBe(CHERRYIN_HOSTS.china)
    expect(
      choosePreferredCherryInHost(
        { host: CHERRYIN_HOSTS.china, latencies: [100, 120], successCount: 2 },
        { host: CHERRYIN_HOSTS.global, latencies: [80], successCount: 1 }
      ).host
    ).toBe(CHERRYIN_HOSTS.china)
    expect(
      choosePreferredCherryInHost(
        { host: CHERRYIN_HOSTS.china, latencies: [100, 120], successCount: 2 },
        { host: CHERRYIN_HOSTS.global, latencies: [40, 60], successCount: 2 }
      ).host
    ).toBe(CHERRYIN_HOSTS.global)
  })

  it('runs two rounds lazily and syncs the selected host to every endpoint', async () => {
    mocks.fetch.mockImplementation((url: string) => Promise.resolve(response(url.startsWith(CHERRYIN_HOSTS.global))))
    const service = new CherryInEndpointService()

    await expect(service.getSelection()).resolves.toMatchObject({ host: CHERRYIN_HOSTS.global, mode: 'auto' })

    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(mocks.updateProvider).toHaveBeenCalledWith('cherryin', {
      endpointConfigs: {
        openai: { baseUrl: CHERRYIN_HOSTS.global },
        anthropic: { baseUrl: CHERRYIN_HOSTS.global }
      }
    })
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'cherryin.endpoint_selected',
      expect.objectContaining({ host: CHERRYIN_HOSTS.global })
    )
  })

  it('persists a manual mode and ignores an older automatic result', async () => {
    mocks.fetch.mockResolvedValue(response())
    const service = new CherryInEndpointService()
    const automatic = service.initialize()

    await expect(service.setMode('global')).resolves.toEqual({
      host: CHERRYIN_HOSTS.global,
      mode: 'global',
      source: 'manual'
    })
    await automatic

    expect(mocks.updateProvider).toHaveBeenCalledWith('cherryin', {
      providerSettings: { cherryInHostMode: 'global' }
    })
    const endpointWrites = mocks.updateProvider.mock.calls.filter(([, patch]) => patch.endpointConfigs)
    expect(endpointWrites).toHaveLength(1)
    expect(endpointWrites[0][1].endpointConfigs.openai.baseUrl).toBe(CHERRYIN_HOSTS.global)
  })

  it('prewarms only an enabled CherryIN provider', async () => {
    mocks.fetch.mockResolvedValue(response())
    const disabled = new CherryInEndpointService()
    ;(disabled as unknown as { onReady(): void }).onReady()
    await Promise.resolve()
    expect(mocks.fetch).not.toHaveBeenCalled()

    BaseService.resetInstances()
    provider.isEnabled = true
    const enabled = new CherryInEndpointService()
    ;(enabled as unknown as { onReady(): void }).onReady()
    await Promise.resolve()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
})
