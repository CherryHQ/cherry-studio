import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationTree = vi.fn()
const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { getOrganizationTree }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import { createKbTreeToolEntry, KB_TREE_TOOL_NAME } from '../KnowledgeTreeTool'

const entry = createKbTreeToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return { id: 'assistant-1', knowledgeBaseIds: [], ...overrides } as Assistant
}

type TreeArgs = { baseId: string; maxDepth?: number }

function callExecute(args: TreeArgs, ctx: { assistant?: Assistant } = {}): Promise<unknown> {
  const execute = entry.tool.execute as (args: TreeArgs, options: ToolExecutionOptions) => Promise<unknown>
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

function orgTree(overrides: Record<string, unknown> = {}) {
  return {
    baseId: 'kb-1',
    totalItems: 2,
    truncated: false,
    nodes: [
      { depth: 0, title: 'docs', itemType: 'directory', status: 'completed', conceptId: undefined },
      { depth: 1, title: 'report.pdf', itemType: 'file', status: 'completed', conceptId: 'report.pdf' }
    ],
    ...overrides
  }
}

describe('kb_tree', () => {
  beforeEach(() => {
    getOrganizationTree.mockReset()
    loggerWarn.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_TREE_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('always')
  })

  it('returns an error and does not traverse when the base is outside the assistant scope', async () => {
    const result = (await callExecute(
      { baseId: 'kb-other' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-other')
    expect(getOrganizationTree).not.toHaveBeenCalled()
  })

  it('outlines an in-scope base, forwarding maxDepth and mapping itemType → type', async () => {
    getOrganizationTree.mockResolvedValue(orgTree())

    const result = await callExecute(
      { baseId: 'kb-1', maxDepth: 2 },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(getOrganizationTree).toHaveBeenCalledWith('kb-1', { maxDepth: 2 })
    expect(result).toEqual({
      baseId: 'kb-1',
      totalItems: 2,
      truncated: false,
      nodes: [
        { depth: 0, title: 'docs', type: 'directory', status: 'completed', conceptId: undefined },
        { depth: 1, title: 'report.pdf', type: 'file', status: 'completed', conceptId: 'report.pdf' }
      ]
    })
  })

  it('maps a NOT_FOUND base to a steer toward kb_list', async () => {
    getOrganizationTree.mockRejectedValue(DataApiErrorFactory.notFound('Knowledge base', 'kb-gone'))

    const result = (await callExecute(
      { baseId: 'kb-gone' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-gone'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-gone')
    expect(result.error).toContain('kb_list')
  })

  describe('toModelOutput', () => {
    const toModelOutput = entry.tool.toModelOutput as (opts: {
      toolCallId: string
      input: TreeArgs
      output: unknown
    }) => { type: string; value: unknown }

    it('passes a non-empty tree through as json', () => {
      const output = orgTree()
      const result = toModelOutput({ toolCallId: 'tc-1', input: { baseId: 'kb-1' }, output })
      expect(result).toEqual({ type: 'json', value: output })
    })

    it('returns an empty-base hint as text', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1' },
        output: orgTree({ totalItems: 0, nodes: [] })
      })
      expect(result.type).toBe('text')
      expect(result.value).toMatch(/no items/i)
    })

    it('renders an error as text', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1' },
        output: { error: 'nope' }
      })
      expect(result).toEqual({ type: 'text', value: 'nope' })
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
