import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

import { callBuiltinTool, toolText } from '../servers/__tests__/builtinMcpClient'
import { createDifyKnowledgeServer } from '../servers/difyKnowledge'

const searchKnowledge = (args: Record<string, unknown>) =>
  callBuiltinTool(() => createDifyKnowledgeServer('key', ['https://api.example.com']), 'search_knowledge', args)

function sentTopK(): unknown {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
  return JSON.parse(init.body).retrieval_model.top_k
}

describe('dify-knowledge search_knowledge', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ records: [] }) })
  })

  it('sends an explicit topK of 0 to the retrieval API instead of the default', async () => {
    const result = await searchKnowledge({ id: 'ds-1', query: 'hello', topK: 0 })

    expect(sentTopK()).toBe(0)
    expect(result.isError).toBeFalsy()
  })

  it('falls back to the default topK when the argument is omitted', async () => {
    await searchKnowledge({ id: 'ds-1', query: 'hello' })

    expect(sentTopK()).toBe(6)
  })

  it('rejects a call without a knowledge id before reaching the API', async () => {
    const result = await searchKnowledge({ query: 'hello' })

    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an API failure as a tool error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' })

    const result = await searchKnowledge({ id: 'ds-1', query: 'hello' })

    expect(result.isError).toBe(true)
    expect(toolText(result)).toContain('bad key')
  })
})
