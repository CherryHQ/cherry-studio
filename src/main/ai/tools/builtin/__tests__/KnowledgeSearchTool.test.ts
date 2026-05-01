import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const orchestratorSearch = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeOrchestrationService') return { search: orchestratorSearch }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { createKbSearchToolEntry, KB_SEARCH_TOOL_NAME } from '../KnowledgeSearchTool'

const entry = createKbSearchToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    knowledgeBaseIds: [],
    ...overrides
  } as Assistant
}

function callExecute(
  args: { query: string },
  ctx: { assistant?: Assistant; abortSignal?: AbortSignal } = {}
): Promise<unknown> {
  const execute = entry.tool.execute as (args: { query: string }, options: ToolExecutionOptions) => Promise<unknown>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: {
      requestId: 'req-1',
      assistant: ctx.assistant,
      abortSignal: ctx.abortSignal ?? new AbortController().signal
    }
  } as ToolExecutionOptions)
}

describe('kb__search', () => {
  beforeEach(() => {
    orchestratorSearch.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_SEARCH_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('never')
  })

  it('returns [] when assistant has no knowledge bases', async () => {
    const result = await callExecute({ query: 'foo' }, { assistant: makeAssistant({ knowledgeBaseIds: [] }) })
    expect(result).toEqual([])
    expect(orchestratorSearch).not.toHaveBeenCalled()
  })

  it('returns [] when no assistant is on RequestContext', async () => {
    const result = await callExecute({ query: 'foo' })
    expect(result).toEqual([])
  })

  it('queries every knowledge base for the model-supplied query', async () => {
    orchestratorSearch.mockResolvedValue([])
    await callExecute(
      { query: 'how does X work' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )
    expect(orchestratorSearch).toHaveBeenCalledTimes(2)
    expect(orchestratorSearch).toHaveBeenCalledWith('kb-1', 'how does X work')
    expect(orchestratorSearch).toHaveBeenCalledWith('kb-2', 'how does X work')
  })

  it('aggregates, dedupes by content, sorts by score desc, assigns 1-based ids', async () => {
    orchestratorSearch.mockImplementation(async (baseId: string) => {
      if (baseId === 'kb-1') {
        return [
          { pageContent: 'A', score: 0.8, metadata: {} },
          { pageContent: 'B', score: 0.5, metadata: {} }
        ]
      }
      // kb-2 has overlapping 'A' with higher score, plus a unique 'C'
      return [
        { pageContent: 'A', score: 0.95, metadata: {} },
        { pageContent: 'C', score: 0.6, metadata: {} }
      ]
    })

    const result = (await callExecute(
      { query: 'q' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )) as Array<{ id: number; content: string; score: number }>

    expect(result).toEqual([
      { id: 1, content: 'A', score: 0.95 },
      { id: 2, content: 'C', score: 0.6 },
      { id: 3, content: 'B', score: 0.5 }
    ])
  })

  it('logs and yields [] for one base when its search throws, but other bases continue', async () => {
    orchestratorSearch.mockImplementation(async (baseId: string) => {
      if (baseId === 'broken') throw new Error('vector store down')
      return [{ pageContent: 'ok', score: 0.7, metadata: {} }]
    })
    const result = (await callExecute(
      { query: 'q' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['broken', 'good'] }) }
    )) as Array<{ id: number; content: string }>
    expect(result).toEqual([{ id: 1, content: 'ok', score: 0.7 }])
  })
})
