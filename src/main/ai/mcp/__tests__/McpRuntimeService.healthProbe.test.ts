import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SseError
} from '@modelcontextprotocol/client'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'

const catalogMock = vi.hoisted(() => ({
  clearSharedToolsCache: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined)
}))
const broadcastToType = vi.hoisted(() => vi.fn())
const createExternal = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: catalogMock,
    IpcApiService: { broadcastToType }
  } as Record<string, unknown>)
})

vi.mock('../connections/ExternalMcpConnection', () => ({ createExternalMcpConnection: createExternal }))

const getById = vi.fn<(id: string) => McpServer>()
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { getById: (id: string) => getById(id) } }))

const { McpRuntimeService, isUnsupportedProbeError } = await import('../McpRuntimeService')

const server = { id: 'legacy', name: 'legacy', isActive: true, command: process.execPath } as McpServer
const tools = [{ name: 'echo', inputSchema: { type: 'object' } }]

function connection(health: () => Promise<void>) {
  return {
    era: 'legacy' as const,
    health: vi.fn(health),
    listTools: vi.fn().mockResolvedValue(tools),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

describe('probe error classification', () => {
  it('treats only an unsupported probe method as non-fatal, including wrapped errors', () => {
    const unsupported = new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, 'Method not supported')
    const notFound = new ProtocolError(ProtocolErrorCode.MethodNotFound, 'No ping')
    expect(isUnsupportedProbeError(unsupported)).toBe(true)
    expect(isUnsupportedProbeError(notFound)).toBe(true)
    expect(isUnsupportedProbeError(new Error('wrapper', { cause: notFound }))).toBe(true)

    for (const error of [
      new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'),
      new SdkError(SdkErrorCode.NotConnected, 'Not connected'),
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
      new SseError(500, 'Server error', {} as ErrorEvent),
      new SdkHttpError(SdkErrorCode.ClientHttpFailedToOpenStream, 'HTTP failed', { status: 500 }),
      new SdkHttpError(SdkErrorCode.MethodNotSupportedByProtocolVersion, 'HTTP failed', { status: 500 }),
      new Error('unknown'),
      { code: ProtocolErrorCode.MethodNotFound }
    ]) {
      expect(isUnsupportedProbeError(error)).toBe(false)
    }
  })
})

describe('McpRuntimeService unsupported probe methods', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getById.mockReturnValue(server)
    broadcastToType.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([['method not found', new ProtocolError(ProtocolErrorCode.MethodNotFound, 'No ping')]])(
    'keeps the existing connection when the probe hits a %s',
    async (_name, error) => {
      const service = new McpRuntimeService()
      const existing = connection(async () => {
        throw error
      })
      const key = service.getServerKey(server)
      ;(service as any).connections.set(key, existing)
      const create = vi.spyOn(service as any, 'createConnection')

      await expect(service.listTools(server.id)).resolves.toEqual(tools)
      await expect(service.listTools(server.id)).resolves.toEqual(tools)

      expect(existing.listTools).toHaveBeenCalledTimes(2)
      expect(existing.close).not.toHaveBeenCalled()
      expect((service as any).connections.get(key)).toBe(existing)
      expect((service as any).connectFailures.size).toBe(0)
      expect(create).not.toHaveBeenCalled()
    }
  )
})
