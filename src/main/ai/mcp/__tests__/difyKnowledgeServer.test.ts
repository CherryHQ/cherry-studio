import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<unknown, (request: unknown) => Promise<unknown>>())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>) {
      handlers.set(schema, handler)
    }
  }
}))

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

import DifyKnowledgeServer from '../servers/difyKnowledge'

type ToolResponse = { content: Array<{ type: string; text: string }>; isError?: boolean }

function getToolHandler() {
  const handler = handlers.get(CallToolRequestSchema)
  if (!handler) throw new Error('CallToolRequestSchema handler was not registered')
  return handler
}

describe('DifyKnowledgeServer.search_knowledge', () => {
  beforeEach(() => {
    handlers.clear()
    fetchMock.mockClear()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ records: [] }) })
  })

  it('sends an explicit topK of 0 to the retrieval API instead of the default', async () => {
    new DifyKnowledgeServer('key', ['https://api.example.com'])
    const handler = getToolHandler()

    const response = (await handler({
      params: { name: 'search_knowledge', arguments: { id: 'ds-1', query: 'hello', topK: 0 } }
    })) as ToolResponse

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body).retrieval_model.top_k).toBe(0)
    expect(response.isError ?? false).toBe(false)
  })

  it('falls back to the default topK when the argument is omitted', async () => {
    new DifyKnowledgeServer('key', ['https://api.example.com'])
    const handler = getToolHandler()

    await handler({ params: { name: 'search_knowledge', arguments: { id: 'ds-1', query: 'hello' } } })

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body).retrieval_model.top_k).toBe(6)
  })
})
