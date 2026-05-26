import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const orchestratorListBases = vi.fn<() => Promise<KnowledgeBase[]>>()
const orchestratorListRootItems = vi.fn<(baseId: string) => Promise<KnowledgeItem[]>>()

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeOrchestrationService') {
        return { listBases: orchestratorListBases, listRootItems: orchestratorListRootItems }
      }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { createKbListToolEntry, KB_LIST_TOOL_NAME } from '../KnowledgeListTool'

const entry = createKbListToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    knowledgeBaseIds: [],
    ...overrides
  } as Assistant
}

function makeBase(overrides: Partial<KnowledgeBase> & { id: string }): KnowledgeBase {
  return {
    name: 'Base',
    emoji: '📁',
    groupId: null,
    dimensions: 1024,
    embeddingModelId: 'm',
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    documentCount: 5,
    searchMode: 'hybrid',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  } as KnowledgeBase
}

function makeFileItem(id: string, originName: string): KnowledgeItem {
  return {
    id,
    baseId: 'base',
    groupId: null,
    type: 'file',
    status: 'completed',
    phase: null,
    error: null,
    data: {
      source: id,
      file: {
        id: 'f',
        name: 'stored.bin',
        origin_name: originName,
        path: '/tmp/x',
        size: 0,
        ext: '.txt',
        type: 'document',
        created_at: '2024-01-01',
        count: 0
      }
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  } as unknown as KnowledgeItem
}

function makeUrlItem(id: string, url: string): KnowledgeItem {
  return {
    id,
    baseId: 'base',
    groupId: null,
    type: 'url',
    status: 'completed',
    phase: null,
    error: null,
    data: { source: id, url },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  } as unknown as KnowledgeItem
}

function makeNoteItem(id: string, content: string): KnowledgeItem {
  return {
    id,
    baseId: 'base',
    groupId: null,
    type: 'note',
    status: 'completed',
    phase: null,
    error: null,
    data: { source: id, content },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  } as unknown as KnowledgeItem
}

function makeDirectoryItem(id: string, path: string): KnowledgeItem {
  return {
    id,
    baseId: 'base',
    groupId: null,
    type: 'directory',
    status: 'completed',
    phase: null,
    error: null,
    data: { source: id, path },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  } as unknown as KnowledgeItem
}

function makeProcessingFileItem(id: string): KnowledgeItem {
  return {
    id,
    baseId: 'base',
    groupId: null,
    type: 'file',
    status: 'processing',
    phase: 'reading',
    error: null,
    data: {
      source: id,
      file: {
        id: 'f',
        name: 'pending.bin',
        origin_name: 'pending.bin',
        path: '/tmp/p',
        size: 0,
        ext: '.txt',
        type: 'document',
        created_at: '2024-01-01',
        count: 0
      }
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  } as unknown as KnowledgeItem
}

function callExecute(
  args: { query?: string; groupId?: string },
  ctx: { assistant?: Assistant } = {}
): Promise<unknown> {
  const execute = entry.tool.execute as (
    args: { query?: string; groupId?: string },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: {
      requestId: 'req-1',
      assistant: ctx.assistant,
      abortSignal: new AbortController().signal
    }
  } as ToolExecutionOptions)
}

describe('kb__list', () => {
  beforeEach(() => {
    orchestratorListBases.mockReset()
    orchestratorListRootItems.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_LIST_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('auto')
  })

  it('returns only bases in the assistant scope when knowledgeBaseIds is non-empty', async () => {
    orchestratorListBases.mockResolvedValue([
      makeBase({ id: 'kb-1', name: 'Allowed' }),
      makeBase({ id: 'kb-other', name: 'Other' })
    ])
    orchestratorListRootItems.mockResolvedValue([])

    const result = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      id: string
    }>
    expect(result.map((b) => b.id)).toEqual(['kb-1'])
    expect(orchestratorListRootItems).toHaveBeenCalledWith('kb-1')
    expect(orchestratorListRootItems).not.toHaveBeenCalledWith('kb-other')
  })

  it('returns all bases when assistant scope is empty (future toggle path)', async () => {
    orchestratorListBases.mockResolvedValue([makeBase({ id: 'kb-1' }), makeBase({ id: 'kb-2' })])
    orchestratorListRootItems.mockResolvedValue([])

    const result = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: [] }) })) as Array<{
      id: string
    }>
    expect(result.map((b) => b.id).sort()).toEqual(['kb-1', 'kb-2'])
  })

  it('filters by groupId', async () => {
    orchestratorListBases.mockResolvedValue([
      makeBase({ id: 'kb-1', groupId: 'g1' }),
      makeBase({ id: 'kb-2', groupId: 'g2' })
    ])
    orchestratorListRootItems.mockResolvedValue([])

    const result = (await callExecute(
      { groupId: 'g1' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2'] }) }
    )) as Array<{ id: string }>
    expect(result.map((b) => b.id)).toEqual(['kb-1'])
  })

  it('filters by case-insensitive query against name and sampleSources', async () => {
    orchestratorListBases.mockResolvedValue([
      makeBase({ id: 'kb-1', name: 'Rust Notes' }),
      makeBase({ id: 'kb-2', name: 'Recipes' }),
      makeBase({ id: 'kb-3', name: 'Other' })
    ])
    orchestratorListRootItems.mockImplementation(async (baseId) => {
      if (baseId === 'kb-3') return [makeNoteItem('n1', 'Some rust tutorial intro')]
      return []
    })

    const result = (await callExecute(
      { query: 'RUST' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1', 'kb-2', 'kb-3'] }) }
    )) as Array<{ id: string }>
    expect(result.map((b) => b.id).sort()).toEqual(['kb-1', 'kb-3'])
  })

  it('derives sampleSources per item type and skips non-completed items', async () => {
    orchestratorListBases.mockResolvedValue([makeBase({ id: 'kb-1' })])
    orchestratorListRootItems.mockResolvedValue([
      makeFileItem('i1', 'design-doc.pdf'),
      makeUrlItem('i2', 'https://example.com/post'),
      makeNoteItem('i3', '\n\nFirst real line of the note\nsecond line'),
      makeDirectoryItem('i4', '/Users/me/notes'),
      makeProcessingFileItem('i5')
    ])

    const [base] = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      sampleSources: string[]
      itemCount: number
    }>
    expect(base.itemCount).toBe(5)
    expect(base.sampleSources).toEqual([
      'design-doc.pdf',
      'https://example.com/post',
      'First real line of the note',
      '/Users/me/notes'
    ])
  })

  it('truncates long note first lines to fit the snippet limit', async () => {
    orchestratorListBases.mockResolvedValue([makeBase({ id: 'kb-1' })])
    orchestratorListRootItems.mockResolvedValue([makeNoteItem('n1', 'a'.repeat(200))])

    const [base] = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      sampleSources: string[]
    }>
    expect(base.sampleSources).toHaveLength(1)
    const [snippet] = base.sampleSources
    expect(snippet.length).toBeLessThanOrEqual(80)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('caps sampleSources at 8 entries', async () => {
    orchestratorListBases.mockResolvedValue([makeBase({ id: 'kb-1' })])
    const items = Array.from({ length: 12 }, (_, idx) => makeFileItem(`i${idx}`, `file-${idx}.md`))
    orchestratorListRootItems.mockResolvedValue(items)

    const [base] = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      sampleSources: string[]
    }>
    expect(base.sampleSources).toHaveLength(8)
  })

  it('lists failed bases with empty sampleSources and does not call listRootItems', async () => {
    orchestratorListBases.mockResolvedValue([
      makeBase({ id: 'kb-1', status: 'failed', error: 'missing_embedding_model' })
    ])

    const [base] = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      id: string
      status: string
      sampleSources: string[]
      itemCount: number
    }>
    expect(base.id).toBe('kb-1')
    expect(base.status).toBe('failed')
    expect(base.sampleSources).toEqual([])
    expect(base.itemCount).toBe(0)
    expect(orchestratorListRootItems).not.toHaveBeenCalled()
  })

  it('still lists a base when listRootItems throws (degrades to empty sampleSources)', async () => {
    orchestratorListBases.mockResolvedValue([makeBase({ id: 'kb-1' })])
    orchestratorListRootItems.mockRejectedValue(new Error('boom'))

    const [base] = (await callExecute({}, { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) })) as Array<{
      id: string
      sampleSources: string[]
    }>
    expect(base.id).toBe('kb-1')
    expect(base.sampleSources).toEqual([])
  })

  describe('toModelOutput', () => {
    type ToModelOutputFn = (opts: {
      toolCallId: string
      input: { query?: string; groupId?: string }
      output: Array<{ id: string }>
    }) => { type: string; value: unknown }

    it('hints "no bases configured" when output is empty without filters', () => {
      const toModelOutput = entry.tool.toModelOutput as ToModelOutputFn
      const result = toModelOutput({ toolCallId: 'tc-1', input: {}, output: [] })
      expect(result.type).toBe('text')
      expect(result.value).toMatch(/no knowledge base/i)
    })

    it('hints "broaden the filter" when output is empty but a query/groupId was passed', () => {
      const toModelOutput = entry.tool.toModelOutput as ToModelOutputFn
      const queryResult = toModelOutput({ toolCallId: 'tc-1', input: { query: 'rust' }, output: [] })
      expect(queryResult.type).toBe('text')
      expect(queryResult.value).toMatch(/broader/i)

      const groupResult = toModelOutput({ toolCallId: 'tc-1', input: { groupId: 'g1' }, output: [] })
      expect(groupResult.value).toMatch(/broader/i)
    })

    it('passes the array through as json when bases are present', () => {
      const toModelOutput = entry.tool.toModelOutput as ToModelOutputFn
      const output = [{ id: 'kb-1' }]
      const result = toModelOutput({ toolCallId: 'tc-1', input: {}, output })
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
