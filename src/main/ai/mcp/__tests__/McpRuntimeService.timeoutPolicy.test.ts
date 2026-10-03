import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Progress
} from '@modelcontextprotocol/sdk/types.js'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'

const mcpCatalogMock = vi.hoisted(() => ({
  clearSharedToolsCache: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ McpCatalogService: mcpCatalogMock } as Record<string, unknown>)
})

const getByIdMock = vi.fn<(id: string) => McpServerEntity>()
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { getById: (id: string) => getByIdMock(id) }
}))

const { McpRuntimeService } = await import('../McpRuntimeService')

type CallHandler = (
  request: { params: { _meta?: { progressToken?: string | number } } },
  extra: {
    signal: AbortSignal
    sendNotification: (notification: {
      method: 'notifications/progress'
      params: Progress & { progressToken: string | number }
    }) => Promise<void>
  }
) => Promise<CallToolResult>

/**
 * Real-SDK behavior tests for the timeout policy McpRuntimeService owns: a real Client over
 * InMemoryTransport so the SDK's request timer and progress-reset machinery actually run,
 * driven by fake timers. These are the regression guards for #20266 — asserting call outcomes,
 * never the RequestOptions shape (#20297 review).
 */
describe('McpRuntimeService.callTool timeout policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Real SDK client wired to an in-memory server whose tool handler is `handler`. */
  async function connectRealClient(handler: CallHandler): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = new McpServer({ name: 'slow', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'slow-tool', description: 'slow', inputSchema: { type: 'object' } }]
    }))
    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      handler(request as Parameters<CallHandler>[0], extra)
    )
    await server.connect(serverTransport)
    const client = new Client({ name: 'cherry-test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(clientTransport)
    return client
  }

  function serverWith(policy: { timeout?: number; longRunning?: boolean }): McpServerEntity {
    return { id: 'srv', name: 'srv', isActive: true, ...policy }
  }

  it('terminates a call at the per-server timeout', async () => {
    getByIdMock.mockReturnValue(serverWith({ timeout: 1 }))
    const client = await connectRealClient(async () => new Promise<CallToolResult>(() => {}))
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue(client)

    const call = service.callTool({ serverId: 'srv', name: 'slow-tool', args: {} })
    const rejection = expect(call).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1_000)
    await rejection
    await client.close()
  })

  it('keeps a long-running call alive through progress notifications', async () => {
    getByIdMock.mockReturnValue(serverWith({ timeout: 1, longRunning: true }))
    const client = await connectRealClient(async (request, extra) => {
      const token = request.params._meta?.progressToken
      await new Promise<void>((resolve) => {
        let elapsed = 0
        const tick = (): void => {
          elapsed += 500
          extra
            .sendNotification({
              method: 'notifications/progress',
              params: { progressToken: token!, progress: elapsed }
            })
            .catch(() => undefined)
          if (elapsed >= 2_500) resolve()
          else setTimeout(tick, 500)
        }
        setTimeout(tick, 500)
      })
      return { content: [{ type: 'text', text: 'done after renewal' }] }
    })
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue(client)

    // Outlives the 1s per-progress window thanks to renewal; dead at 1s if reset is dropped.
    const call = service.callTool({ serverId: 'srv', name: 'slow-tool', args: {} })
    const completion = expect(call).resolves.toMatchObject({
      content: [{ type: 'text', text: 'done after renewal' }]
    })
    await vi.advanceTimersByTimeAsync(3_000)
    await completion
    await client.close()
  })

  it('caps a long-running call at the 10-minute total budget', async () => {
    getByIdMock.mockReturnValue(serverWith({ timeout: 60, longRunning: true }))
    const client = await connectRealClient(async (request, extra) => {
      const token = request.params._meta?.progressToken
      const tick = (): void => {
        extra
          .sendNotification({ method: 'notifications/progress', params: { progressToken: token!, progress: 1 } })
          .catch(() => undefined)
        setTimeout(tick, 30_000)
      }
      setTimeout(tick, 30_000)
      return new Promise<CallToolResult>(() => {})
    })
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue(client)

    const call = service.callTool({ serverId: 'srv', name: 'slow-tool', args: {} })
    const rejection = expect(call).rejects.toThrow(/maximum total timeout exceeded/i)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 60_000)
    await rejection
    await client.close()
  })
})
