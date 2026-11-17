import { SdkErrorCode, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer, Server } from '@modelcontextprotocol/server'
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

describe('legacy MCP health over handler.fetch', () => {
  const fixture = async (result: Record<string, unknown>, tools = false) => {
    let reachable = true
    const tool = { name: 'echo', inputSchema: { type: 'object' as const } }
    const content = [{ type: 'text' as const, text: 'usable' }]
    const handler = createMcpHandler(() => {
      const server = new Server({ name: 'legacy-health', version: '1' }, { capabilities: tools ? { tools: {} } : {} })
      server.setRequestHandler('ping', async () => result)
      if (tools) {
        server.setRequestHandler('tools/list', async () => ({ tools: [tool] }))
        server.setRequestHandler('tools/call', async () => ({ content }))
      }
      return server
    })
    const connection = new ClientMcpConnection(
      { name: 'test', version: '1' },
      {
        capabilities: { elicitation: { form: {}, url: {} }, sampling: {}, roots: {} },
        versionNegotiation: { mode: 'legacy' }
      },
      events
    )
    await connection.connect(
      new StreamableHTTPClientTransport(new URL('http://legacy-health.test/mcp'), {
        fetch: (input, init) => {
          if (!reachable) throw new Error('health endpoint unavailable')
          return fetchMcpHandler(handler, input, init)
        }
      })
    )
    return {
      connection,
      tool,
      content,
      stop: () => {
        reachable = false
      },
      close: async () => {
        await connection.close()
        await handler.close()
      }
    }
  }

  it.each([
    { name: 'extra fields with a usable tool', result: { status: 'ok' }, tools: true },
    { name: 'extra fields without catalog capabilities', result: { status: 'ok' }, tools: false },
    { name: 'an empty result control', result: {}, tools: false },
    {
      name: 'extra fields with valid legacy metadata',
      result: { status: 'ok', _meta: { progressToken: 'p1' } },
      tools: false
    }
  ])('accepts $name on consecutive health checks', async ({ result, tools }) => {
    const test = await fixture(result, tools)
    try {
      expect(test.connection.era).toBe('legacy')
      await expect(test.connection.health()).resolves.toBeUndefined()
      await expect(test.connection.health()).resolves.toBeUndefined()
      if (tools) {
        expect(await test.connection.listTools('refresh')).toContainEqual(test.tool)
        expect(await test.connection.callTool('echo', {}, options())).toEqual({ content: test.content })
      }
    } finally {
      await test.close()
    }
  })

  it.each([{ progressToken: false }, { 'io.modelcontextprotocol/related-task': { taskId: 9 } }])(
    'rejects malformed recognized legacy metadata: %j',
    async (_meta) => {
      const test = await fixture({ _meta })
      try {
        await expect(test.connection.health()).rejects.toMatchObject({ code: SdkErrorCode.InvalidResult })
      } finally {
        await test.close()
      }
    }
  )

  it('rejects an endpoint failure after a successful health check', async () => {
    const test = await fixture({ status: 'ok' }, true)
    try {
      await expect(test.connection.health()).resolves.toBeUndefined()
      test.stop()
      await expect(test.connection.health()).rejects.toThrow('health endpoint unavailable')
    } finally {
      await test.close()
    }
  })
})

describe('MCP catalog over modern handler.fetch', () => {
  it('rejects a malformed modern discover result even with an advertised tool catalog', async () => {
    let malformed = false
    const handler = createMcpHandler(
      () => {
        const server = new Server({ name: 'modern-health', version: '1' }, { capabilities: { tools: {} } })
        server.setRequestHandler('tools/list', async () => ({ tools: [] }))
        return server
      },
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
    await connection.connect(
      new StreamableHTTPClientTransport(new URL('http://modern-health.test/mcp'), {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const isDiscover = request.method === 'POST' && (await request.clone().json()).method === 'server/discover'
          const response = await fetchMcpHandler(handler, input, init)
          if (!malformed || !isDiscover) return response
          const body = await response.json()
          return Response.json({ ...body, result: {} }, response)
        }
      })
    )
    try {
      expect(connection.era).toBe('modern')
      await expect(connection.health()).resolves.toBeUndefined()
      malformed = true
      expect(await connection.listTools('refresh')).toEqual([])
      await expect(connection.health()).rejects.toMatchObject({ code: SdkErrorCode.InvalidResult })
    } finally {
      await connection.close()
      await handler.close()
    }
  })

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
