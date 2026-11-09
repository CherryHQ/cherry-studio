/**
 * Pins the probe's verdict table for `FileProcessingService.checkOpenMineruConnectivity`.
 *
 * The asymmetry is the whole design: 404 is the only status that means "not the
 * service we want", and everything else — including 503, which is how MinerU
 * reports a full request queue — has to stay reachable. Getting this backwards
 * greys out a working deployment, and the knowledge-base dropdown that consumes
 * it offers no way to retry.
 */
import type * as LifecycleModule from '@main/core/lifecycle'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, getFileProcessorConfigByIdMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getFileProcessorConfigByIdMock: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

vi.mock('@application', () => ({ application: { get: vi.fn() } }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {}
  return { ...actual, BaseService: MockBaseService }
})

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: vi.fn(),
  getFileProcessorConfigById: getFileProcessorConfigByIdMock
}))

import { FileProcessingService } from '../FileProcessingService'

const configWithHost = (apiHost: string | undefined): FileProcessorMerged =>
  ({
    id: 'open-mineru',
    type: 'api',
    capabilities: [{ feature: 'document_to_markdown', inputs: ['document'], output: 'markdown', apiHost }]
  }) as FileProcessorMerged

const probe = () => new FileProcessingService().checkOpenMineruConnectivity()

beforeEach(() => {
  vi.clearAllMocks()
  getFileProcessorConfigByIdMock.mockReturnValue(configWithHost('http://127.0.0.1:8000'))
})

describe('checkOpenMineruConnectivity', () => {
  it('probes /health on the configured host with a bounded signal', async () => {
    fetchMock.mockResolvedValue({ status: 200 })

    await expect(probe()).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/health')
    expect(init.method).toBe('GET')
    // Without this an unroutable host hangs the dropdown until the OS gives up.
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back to /v1/health when /health returns 404 (MinerU 4.x)', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 404 }) // /health returns 404
      .mockResolvedValueOnce({ status: 200 }) // /v1/health returns 200

    await expect(probe()).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/health')
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8000/v1/health')
  })

  it('reports unreachable when both /health and /v1/health return 404', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 404 })

    await expect(probe()).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    // 404 on /health triggers fallback to /v1/health; only 404 on BOTH means not MinerU.
    // MinerU returns 503 once max_concurrent_requests is saturated — a busy server
    // is a running server.
    [200, true],
    [503, true],
    // A reverse proxy in front of MinerU answers before routing.
    [401, true],
    [403, true],
    [500, true]
  ])('maps HTTP %i on /health to reachable=%s without fallback', async (status, expected) => {
    fetchMock.mockResolvedValue({ status })

    await expect(probe()).resolves.toBe(expected)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports unreachable when nothing is listening', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))

    await expect(probe()).resolves.toBe(false)
  })

  it('reports unreachable without a request when the host was cleared', async () => {
    getFileProcessorConfigByIdMock.mockReturnValue(configWithHost('   '))

    await expect(probe()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not double the slash when the host has a trailing one', async () => {
    getFileProcessorConfigByIdMock.mockReturnValue(configWithHost('http://127.0.0.1:8000/'))
    fetchMock.mockResolvedValue({ status: 200 })

    await probe()

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/health')
  })
})
