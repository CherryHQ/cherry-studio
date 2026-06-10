import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeServiceSearch = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { search: knowledgeServiceSearch }
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

type KbSearchArgs = { query: string; baseIds: string[]; topK?: number; threshold?: number }

function callExecute(
  args: KbSearchArgs,
  ctx: { assistant?: Assistant; abortSignal?: AbortSignal } = {}
): Promise<unknown> {
  const execute = entry.tool.execute as (args: KbSearchArgs, options: ToolExecutionOptions) => Promise<unknown>
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
    knowledgeServiceSearch.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_SEARCH_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('auto')
  })

  it('returns [] and does not search when every requested baseId is outside the assistant scope', async () => {
    const result = await callExecute(
      { query: 'foo', baseIds: ['kb-other'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )
    expect(result).toEqual([])
    expect(knowledgeServiceSearch).not.toHaveBeenCalled()
  })

  it('drops out-of-scope baseIds but still searches the in-scope ones', async () => {
    knowledgeServiceSearch.mockResolvedValue([])
    await callExecute(
      { query: 'q', baseIds: ['kb-1', 'kb-other'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )
    expect(knowledgeServiceSearch).toHaveBeenCalledTimes(1)
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-1', 'q', {
      topK: undefined,
      threshold: undefined
    })
  })

  it('trusts the requested baseIds when assistant scope is empty (future toggle path)', async () => {
    knowledgeServiceSearch.mockResolvedValue([])
    await callExecute({ query: 'q', baseIds: ['kb-1', 'kb-2'] }, { assistant: makeAssistant({ knowledgeBaseIds: [] }) })
    expect(knowledgeServiceSearch).toHaveBeenCalledTimes(2)
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-1', 'q', {
      topK: undefined,
      threshold: undefined
    })
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-2', 'q', {
      topK: undefined,
      threshold: undefined
    })
  })

  it('queries every requested base when all are in-scope', async () => {
    knowledgeServiceSearch.mockResolvedValue([])
    await callExecute(
      { query: 'how does X work', baseIds: ['kb-1', 'kb-2'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )
    expect(knowledgeServiceSearch).toHaveBeenCalledTimes(2)
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-1', 'how does X work', {
      topK: undefined,
      threshold: undefined
    })
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-2', 'how does X work', {
      topK: undefined,
      threshold: undefined
    })
  })

  it('aggregates, dedupes by content, sorts by score desc, assigns 1-based ids', async () => {
    knowledgeServiceSearch.mockImplementation(async (baseId: string) => {
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
      { query: 'q', baseIds: ['kb-1', 'kb-2'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )) as Array<{ id: number; content: string; score: number }>

    expect(result).toEqual([
      { id: 1, content: 'A', score: 0.95 },
      { id: 2, content: 'C', score: 0.6 },
      { id: 3, content: 'B', score: 0.5 }
    ])
  })

  it('logs and yields [] for one base when its search throws, but other bases continue', async () => {
    knowledgeServiceSearch.mockImplementation(async (baseId: string) => {
      if (baseId === 'broken') throw new Error('vector store down')
      return [{ pageContent: 'ok', score: 0.7, metadata: {} }]
    })
    const result = (await callExecute(
      { query: 'q', baseIds: ['broken', 'good'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['broken', 'good'] }) }
    )) as Array<{ id: number; content: string }>
    expect(result).toEqual([{ id: 1, content: 'ok', score: 0.7 }])
  })

  it('returns an { error } result (not []) when every requested base fails to search', async () => {
    // A total failure must stay distinguishable from a genuinely empty result: []
    // would let the model report "no matches" when nothing was actually searchable.
    knowledgeServiceSearch.mockRejectedValue(new Error('vector store down'))
    const result = (await callExecute(
      { query: 'q', baseIds: ['kb-1', 'kb-2'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )) as { error?: string }
    expect(Array.isArray(result)).toBe(false)
    expect(result.error).toMatch(/failed for all 2/i)
    expect(result.error).toContain('vector store down')
  })

  it('passes real topK / threshold through to KnowledgeService.search unchanged', async () => {
    // Guards the per-call knobs: a regression that dropped one would silently
    // revert to the service default — this pins the passthrough. hybridAlpha is
    // intentionally NOT a per-call knob (it is per-base config), so it is absent.
    knowledgeServiceSearch.mockResolvedValue([])
    await callExecute(
      { query: 'q', baseIds: ['kb-1'], topK: 7, threshold: 0.42 },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )
    expect(knowledgeServiceSearch).toHaveBeenCalledWith('kb-1', 'q', {
      topK: 7,
      threshold: 0.42
    })
  })

  describe('toModelOutput', () => {
    it('returns a hint pointing the model at kb__list when output is empty', () => {
      const toModelOutput = entry.tool.toModelOutput as (opts: {
        toolCallId: string
        input: { query: string; baseIds: string[] }
        output: Array<{ id: number; content: string; score: number }>
      }) => { type: string; value: string }
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { query: 'q', baseIds: ['kb-1'] },
        output: []
      })
      expect(result.type).toBe('text')
      expect(result.value).toMatch(/kb__list/)
    })

    it('renders an all-failed note (distinct from the empty-result hint) for the error branch', () => {
      const toModelOutput = entry.tool.toModelOutput as (opts: {
        toolCallId: string
        input: { query: string; baseIds: string[] }
        output: unknown
      }) => { type: string; value: string }
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { query: 'q', baseIds: ['kb-1'] },
        output: { error: 'Knowledge base search failed for all 1 requested base(s): boom' }
      })
      expect(result.type).toBe('text')
      expect(result.value).toMatch(/failed/i)
      // Must NOT be the empty-result hint — the model has to know nothing was searchable.
      expect(result.value).not.toMatch(/kb__list/)
    })

    it('passes the array through as json when results are present', () => {
      const toModelOutput = entry.tool.toModelOutput as (opts: {
        toolCallId: string
        input: { query: string; baseIds: string[] }
        output: Array<{ id: number; content: string; score: number }>
      }) => { type: string; value: unknown }
      const output = [{ id: 1, content: 'A', score: 0.9 }]
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { query: 'q', baseIds: ['kb-1'] },
        output
      })
      expect(result).toEqual({ type: 'json', value: output })
    })
  })

  describe('applies', () => {
    it('returns true only when the assistant has at least one knowledge base id', () => {
      const applies = entry.applies!
      expect(applies({ assistant: undefined, mcpToolIds: new Set() })).toBe(false)
      expect(applies({ assistant: makeAssistant({ knowledgeBaseIds: [] }), mcpToolIds: new Set() })).toBe(false)
      expect(applies({ assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }), mcpToolIds: new Set() })).toBe(true)
    })
  })
})
