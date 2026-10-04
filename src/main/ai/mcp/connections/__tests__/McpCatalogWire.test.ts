import { Server } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'

import { createInProcessMcpConnection } from '../InProcessMcpConnection'

const events = {
  toolsChanged: vi.fn(),
  promptsChanged: vi.fn(),
  resourcesChanged: vi.fn(),
  resourceUpdated: vi.fn(),
  log: vi.fn()
}

const options = () => ({ signal: new AbortController().signal, timeoutMs: 5_000 })

describe('MCP catalog over modern handler.fetch', () => {
  it('uses the SDK positive TTL cache and bypasses it on explicit refresh', async () => {
    let description = 'original'
    let listRequests = 0
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      connectTimeoutMs: 5_000,
      events,
      endpoint: {
        createServer: () => {
          const server = new Server({ name: 'cached-catalog', version: '1' }, { capabilities: { tools: {} } })
          server.setRequestHandler('tools/list', async () => {
            listRequests++
            return {
              tools: [{ name: 'read', description, inputSchema: { type: 'object' } }],
              ttlMs: 60_000,
              cacheScope: 'private'
            }
          })
          return server
        },
        close: async () => undefined
      }
    })
    try {
      expect(await connection.listTools()).toMatchObject([{ description: 'original' }])
      description = 'updated'
      expect(await connection.listTools()).toMatchObject([{ description: 'original' }])
      expect(listRequests).toBe(1)
      expect(await connection.listTools('refresh')).toMatchObject([{ description: 'updated' }])
      expect(listRequests).toBe(2)
    } finally {
      await connection.close()
    }
  })

  it('discovers every template page and reads a URI absent from the static resource list', async () => {
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      connectTimeoutMs: 5_000,
      events,
      endpoint: {
        createServer: () => {
          const server = new Server(
            { name: 'templates', version: '1' },
            {
              capabilities: { resources: {} },
              instructions: 'Expand the document template before reading.'
            }
          )
          server.setRequestHandler('resources/templates/list', async ({ params }) => ({
            resourceTemplates: [
              params?.cursor
                ? { name: 'search', uriTemplate: 'docs://search{?query}' }
                : { name: 'document', uriTemplate: 'docs://documents/{id}' }
            ],
            ...(params?.cursor ? {} : { nextCursor: 'second' })
          }))
          server.setRequestHandler('resources/read', async ({ params }) => ({
            contents: [{ uri: params.uri, text: 'dynamic document' }]
          }))
          return server
        },
        close: async () => undefined
      }
    })
    try {
      expect(await connection.listResourceTemplates()).toEqual([
        { name: 'document', uriTemplate: 'docs://documents/{id}' },
        { name: 'search', uriTemplate: 'docs://search{?query}' }
      ])
      expect(connection.instructions).toBe('Expand the document template before reading.')
      expect(await connection.readResource('docs://documents/42')).toMatchObject({
        contents: [{ uri: 'docs://documents/42', text: 'dynamic document' }]
      })
    } finally {
      await connection.close()
    }
  })

  it.each(['call', 'forward'] as const)(
    'uses refreshed output schemas for %s rather than a stale tool map',
    async (mode) => {
      let arrayOutput = false
      const connection = await createInProcessMcpConnection({
        appVersion: 'test',
        connectTimeoutMs: 5_000,
        events,
        endpoint: {
          createServer: () => {
            const server = new Server({ name: 'changing-schema', version: '1' }, { capabilities: { tools: {} } })
            server.setRequestHandler('tools/list', async () => ({
              ttlMs: 0,
              cacheScope: 'private',
              tools: [
                {
                  name: 'read',
                  inputSchema: { type: 'object' },
                  outputSchema: { type: arrayOutput ? 'array' : 'string' }
                }
              ]
            }))
            server.setRequestHandler('tools/call', async () => ({
              content: [],
              structuredContent: arrayOutput ? ['updated'] : 'original'
            }))
            return server
          },
          close: async () => undefined
        }
      })
      const call = () =>
        mode === 'call'
          ? connection.callTool('read', {}, options())
          : connection.forwardRequest('tools/call', { name: 'read' }, { ...options(), capabilities: {} })
      try {
        expect(await call()).toMatchObject({ structuredContent: 'original' })
        arrayOutput = true
        expect(await call()).toMatchObject({ structuredContent: ['updated'] })
      } finally {
        await connection.close()
      }
    }
  )
})
