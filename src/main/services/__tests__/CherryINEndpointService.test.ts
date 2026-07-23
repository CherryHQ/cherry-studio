import { CHERRYIN_HOSTS } from '@shared/config/cherryin'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ConfigManager', () => ({
  configManager: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('../ReduxService', () => ({
  reduxService: {
    dispatch: vi.fn(),
    select: vi.fn()
  }
}))

import { CherryINEndpointService, choosePreferredCherryInHost } from '../CherryINEndpointService'
import { configManager } from '../ConfigManager'
import { reduxService } from '../ReduxService'

const chinaSummary = (latencies: number[], successCount = latencies.length) => ({
  host: CHERRYIN_HOSTS.china,
  latencies,
  successCount
})

const globalSummary = (latencies: number[], successCount = latencies.length) => ({
  host: CHERRYIN_HOSTS.global,
  latencies,
  successCount
})

describe('choosePreferredCherryInHost', () => {
  it('prefers the host with more successful probes', () => {
    expect(choosePreferredCherryInHost(chinaSummary([500], 1), globalSummary([300, 320], 2))).toEqual({
      host: CHERRYIN_HOSTS.global,
      source: 'probe'
    })
  })

  it('selects the lower-latency host even when the difference is small', () => {
    expect(choosePreferredCherryInHost(chinaSummary([520, 540]), globalSummary([450, 470]))).toEqual({
      host: CHERRYIN_HOSTS.global,
      source: 'probe'
    })
  })

  it('uses the China-optimized host as the deterministic tie-breaker', () => {
    expect(choosePreferredCherryInHost(chinaSummary([500, 520]), globalSummary([490, 530]))).toEqual({
      host: CHERRYIN_HOSTS.china,
      source: 'probe'
    })
  })

  it('selects the global host when it is materially faster', () => {
    expect(choosePreferredCherryInHost(chinaSummary([900, 940]), globalSummary([400, 420]))).toEqual({
      host: CHERRYIN_HOSTS.global,
      source: 'probe'
    })
  })

  it('falls back to the China-optimized host when both hosts are unavailable', () => {
    expect(choosePreferredCherryInHost(chinaSummary([]), globalSummary([]))).toEqual({
      host: CHERRYIN_HOSTS.china,
      source: 'fallback'
    })
  })
})

describe('CherryINEndpointService', () => {
  beforeEach(() => {
    vi.mocked(configManager.get).mockReset()
    vi.mocked(configManager.set).mockReset()
    vi.mocked(reduxService.dispatch).mockReset().mockResolvedValue()
    vi.mocked(reduxService.select).mockReset()
    vi.mocked(net.fetch).mockReset()
  })

  it('applies a manual host without probing', async () => {
    const service = new CherryINEndpointService()

    await expect(service.setMode('global')).resolves.toEqual({
      host: CHERRYIN_HOSTS.global,
      mode: 'global',
      source: 'manual'
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(reduxService.dispatch).toHaveBeenCalledWith({
      type: 'llm/updateProvider',
      payload: {
        anthropicApiHost: CHERRYIN_HOSTS.global,
        apiHost: CHERRYIN_HOSTS.global,
        id: 'cherryin'
      }
    })
  })

  it('falls back to the China-optimized host when automatic probes fail', async () => {
    vi.mocked(configManager.get).mockReturnValue('auto')
    vi.mocked(net.fetch).mockRejectedValue(new Error('offline'))

    const service = new CherryINEndpointService()
    await expect(service.initialize()).resolves.toEqual({
      host: CHERRYIN_HOSTS.china,
      mode: 'auto',
      source: 'fallback'
    })

    expect(net.fetch).toHaveBeenCalledTimes(4)
  })

  it('probes the lightweight liveness endpoint without a cache-busting query', async () => {
    vi.mocked(configManager.get).mockReturnValue('auto')
    vi.mocked(net.fetch).mockImplementation(async () =>
      Response.json({ status: 'ok' }, { headers: { 'Content-Type': 'application/json' } })
    )

    const service = new CherryINEndpointService()
    await expect(service.initialize()).resolves.toMatchObject({
      mode: 'auto',
      source: 'probe'
    })

    expect(net.fetch).toHaveBeenCalledTimes(4)
    expect(vi.mocked(net.fetch).mock.calls.map(([url]) => url)).toEqual([
      `${CHERRYIN_HOSTS.china}/livez`,
      `${CHERRYIN_HOSTS.global}/livez`,
      `${CHERRYIN_HOSTS.china}/livez`,
      `${CHERRYIN_HOSTS.global}/livez`
    ])
  })

  it('rejects a successful HTML response from the probe endpoint', async () => {
    vi.mocked(configManager.get).mockReturnValue('auto')
    vi.mocked(net.fetch).mockImplementation(
      async () => new Response('<html>fallback page</html>', { headers: { 'Content-Type': 'text/html' }, status: 200 })
    )

    const service = new CherryINEndpointService()
    await expect(service.initialize()).resolves.toMatchObject({
      host: CHERRYIN_HOSTS.china,
      mode: 'auto',
      source: 'fallback'
    })
  })

  it('rejects a JSON response that does not satisfy the liveness contract', async () => {
    vi.mocked(configManager.get).mockReturnValue('auto')
    vi.mocked(net.fetch).mockImplementation(async () => Response.json({ status: 'degraded' }))

    const service = new CherryINEndpointService()
    await expect(service.initialize()).resolves.toMatchObject({
      host: CHERRYIN_HOSTS.china,
      mode: 'auto',
      source: 'fallback'
    })
  })

  it('defaults to automatic selection when no host mode has been stored', async () => {
    vi.mocked(configManager.get).mockReturnValue(undefined)
    vi.mocked(net.fetch).mockRejectedValue(new Error('offline'))

    const service = new CherryINEndpointService()
    await expect(service.initialize()).resolves.toMatchObject({
      host: CHERRYIN_HOSTS.china,
      mode: 'auto'
    })

    expect(configManager.set).toHaveBeenCalledWith('cherryIn.hostMode', 'auto')
  })
})
