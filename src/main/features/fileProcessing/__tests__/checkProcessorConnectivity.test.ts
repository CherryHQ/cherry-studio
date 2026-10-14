import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LifecycleModule from '@main/core/lifecycle'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'

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

const configWithHost = (apiHost: string | undefined): FileProcessorMerged => ({
  id: 'open-mineru',
  type: 'api',
  capabilities: [{ feature: 'document_to_markdown', inputs: ['document'], output: 'markdown', apiHost }]
})

const probe = () => new FileProcessingService().checkOpenMineruConnectivity()

beforeEach(() => {
  vi.resetAllMocks()
  getFileProcessorConfigByIdMock.mockReturnValue(configWithHost('http://127.0.0.1:8000'))
})

describe('checkOpenMineruConnectivity', () => {
  it('accepts a V1 deployment with the configured key', async () => {
    getFileProcessorConfigByIdMock.mockReturnValue({ ...configWithHost('http://127.0.0.1:8000'), apiKeys: ['secret'] })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'ok',
        version: '4.0.6',
        features: { sources: ['file_id'], output_formats: ['markdown'] }
      })
    )
    await expect(probe()).resolves.toBe(true)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer secret')
  })

  it('keeps a legacy deployment selectable after V1 is absent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'healthy', version: '3.4.5' }))
    await expect(probe()).resolves.toBe(true)
  })

  it.each([401, 403, 500, 503])(
    'keeps HTTP %i selectable so authentication or service errors can be reported',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }))
      await expect(probe()).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects a host that exposes neither protocol', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }))
    await expect(probe()).resolves.toBe(false)
  })

  it('rejects an unrelated HTML service on the configured port', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>home</html>'))
    await expect(probe()).resolves.toBe(false)
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
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'ok',
        version: '4.0.6',
        features: { sources: ['file_id'], output_formats: ['markdown'] }
      })
    )

    await probe()

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/v1/health')
  })
})
