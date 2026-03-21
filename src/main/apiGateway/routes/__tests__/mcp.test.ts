import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/LoggerService', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    }))
  }
}))

vi.mock('../../services/mcp', () => ({
  mcpApiService: {
    getAllServers: vi.fn(),
    getServerInfo: vi.fn(),
    getServerById: vi.fn(),
    handleRequest: vi.fn()
  }
}))

const { mcpRoutes } = await import('../mcp')
const { mcpApiService } = await import('../../services/mcp')

describe('mcpRoutes', () => {
  let server: ReturnType<express.Application['listen']>
  let baseUrl: string

  beforeEach(async () => {
    const app = express()
    app.use(express.json())
    app.use('/v1/mcps', mcpRoutes)

    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address')
    }

    baseUrl = `http://127.0.0.1:${address.port}`
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  })

  it('returns 503 when getServerById rejects in MCP proxy route', async () => {
    vi.mocked(mcpApiService.getServerById).mockRejectedValue(new Error('store not ready'))

    const response = await fetch(`${baseUrl}/v1/mcps/test-server/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        message: 'Failed to proxy MCP request: store not ready',
        type: 'service_unavailable',
        code: 'mcp_proxy_unavailable'
      }
    })
  })

  it('returns 503 when handleRequest rejects in MCP proxy route', async () => {
    vi.mocked(mcpApiService.getServerById).mockResolvedValue({ id: 'test-server' } as any)
    vi.mocked(mcpApiService.handleRequest).mockRejectedValue(new Error('proxy failure'))

    const response = await fetch(`${baseUrl}/v1/mcps/test-server/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        message: 'Failed to proxy MCP request: proxy failure',
        type: 'service_unavailable',
        code: 'mcp_proxy_unavailable'
      }
    })
  })
})
