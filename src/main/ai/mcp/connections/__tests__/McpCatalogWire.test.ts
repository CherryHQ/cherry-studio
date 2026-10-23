import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer, Server } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { describe, expect, it, vi } from 'vitest'

import { ClientMcpConnection } from '../ClientMcpConnection'
import { createInProcessMcpConnection } from '../InProcessMcpConnection'
import { fetchMcpHandler } from './fetchMcpHandler'

const events = {
  toolsChanged: vi.fn(),
  promptsChanged: vi.fn(),
  resourcesChanged: vi.fn(),
  resourceUpdated: vi.fn(),
  log: vi.fn()
}

const options = () => ({ signal: new AbortController().signal, timeoutMs: 5_000 })

describe('MCP catalog over modern handler.fetch', () => {
  it.each(['legacy', 'modern'] as const)(
    'retains the complete paginated %s catalog with boolean subschemas',
    async (era) => {
      const tools = [
        { name: 'plain', inputSchema: { type: 'object' } },
        {
          name: 'flexible',
          inputSchema: {
            type: 'object',
            properties: {
              allowed: true,
              forbidden: false,
              payload: {},
              nested: { type: 'object', properties: { child: false } },
              sequence: { type: 'array', items: [true, false] },
              alternatives: { anyOf: [true, false] }
            },
            additionalProperties: false
          }
        },
        {
          name: 'output',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', properties: { state: true } }
        },
        { name: 'last', inputSchema: { type: 'object' } }
      ]
      const server = new Server({ name: 'boolean-catalog', version: '1' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async ({ params }) =>
        params?.cursor
          ? { tools: tools.slice(1) }
          : {
              tools: [tools[0]],
              nextCursor: 'second'
            }
      )
      const client = new Client(
        { name: 'test', version: '1' },
        {
          capabilities: { elicitation: { form: {}, url: {} }, sampling: {}, roots: {} },
          versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } }
        }
      )
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const handle =
        era === 'modern' ? serveStdio(() => server, { transport: serverTransport, legacy: 'reject' }) : undefined
      if (!handle) await server.connect(serverTransport)
      await client.connect(clientTransport)
      try {
        expect((await client.listTools()).tools).toEqual(tools)
      } finally {
        await client.close()
        if (handle) await handle.close()
        else await server.close()
      }
    }
  )

  it.each(['legacy', 'modern'] as const)(
    'rejects a malformed %s tool list even when healthy peers are present',
    async (era) => {
      const server = new Server({ name: 'malformed-catalog', version: '1' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async () => ({
        tools: [{ name: 'healthy', inputSchema: { type: 'object' } }, { inputSchema: { type: 'object' } }]
      }))
      const client = new Client(
        { name: 'test', version: '1' },
        { versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } } }
      )
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const handle =
        era === 'modern' ? serveStdio(() => server, { transport: serverTransport, legacy: 'reject' }) : undefined
      if (!handle) await server.connect(serverTransport)
      await client.connect(clientTransport)
      try {
        await expect(client.listTools()).rejects.toThrow(/Invalid result for tools\/list/)
      } finally {
        await client.close()
        if (handle) await handle.close()
        else await server.close()
      }
    }
  )

  it.each(['listTools', 'listPrompts', 'listResources'] as const)(
    'cancels an in-flight %s refresh without closing the connection',
    async (method) => {
      const handler = createMcpHandler(
        () =>
          new Server({ name: 'catalog', version: '1' }, { capabilities: { tools: {}, prompts: {}, resources: {} } }),
        { legacy: 'reject' }
      )
      const connection = new ClientMcpConnection(
        { name: 'test', version: '1' },
        {
          capabilities: { elicitation: { form: {}, url: {} }, sampling: {}, roots: {} },
          versionNegotiation: { mode: { pin: '2026-07-28' } }
        },
        events
      )
      const started = Promise.withResolvers<AbortSignal>()
      await connection.connect(
        new StreamableHTTPClientTransport(new URL('http://catalog.test/mcp'), {
          fetch: async (input, init) => {
            const request = new Request(input, init)
            if (request.method === 'POST' && (await request.json()).method.endsWith('/list')) {
              const signal = request.signal
              started.resolve(signal)
              return new Promise<Response>((_resolve, reject) => {
                signal.throwIfAborted()
                signal.addEventListener('abort', () => reject(signal.reason), { once: true })
              })
            }
            return fetchMcpHandler(handler, input, init)
          }
        })
      )
      try {
        const controller = new AbortController()
        const result = connection[method]('refresh', controller.signal)
        const cancelled = expect(result).rejects.toThrow('catalog refresh cancelled')
        const requestSignal = await started.promise
        controller.abort(new Error('catalog refresh cancelled'))
        await cancelled
        expect(requestSignal.aborted).toBe(true)
        await connection.health()
      } finally {
        await connection.close()
        await handler.close()
      }
    }
  )

  it('uses the SDK positive TTL cache and bypasses it on explicit refresh', async () => {
    let description = 'original'
    let listRequests = 0
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      connectTimeoutMs: 5_000,
      events,
      endpoint: {
        createServer: () => {
          const mcp = new McpServer({ name: 'cached-catalog', version: '1' }, { capabilities: { tools: {} } })
          const server = mcp.server
          server.setRequestHandler('tools/list', async () => {
            listRequests++
            return {
              tools: [{ name: 'read', description, inputSchema: { type: 'object' } }],
              ttlMs: 60_000,
              cacheScope: 'private'
            }
          })
          return mcp
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
          const mcp = new McpServer(
            { name: 'templates', version: '1' },
            {
              capabilities: { resources: {} },
              instructions: 'Expand the document template before reading.'
            }
          )
          const server = mcp.server
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
          return mcp
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
            const mcp = new McpServer({ name: 'changing-schema', version: '1' }, { capabilities: { tools: {} } })
            const server = mcp.server
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
            return mcp
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
