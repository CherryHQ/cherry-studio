import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readConcept = vi.fn()
const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { readConcept }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import { createKbReadToolEntry, KB_READ_TOOL_NAME } from '../KnowledgeReadTool'

const entry = createKbReadToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return { id: 'assistant-1', knowledgeBaseIds: [], ...overrides } as Assistant
}

type ReadArgs = { baseId: string; conceptId: string; charStart?: number; charEnd?: number }

function callExecute(args: ReadArgs, ctx: { assistant?: Assistant } = {}): Promise<unknown> {
  const execute = entry.tool.execute as (args: ReadArgs, options: ToolExecutionOptions) => Promise<unknown>
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

function conceptContent(overrides: Record<string, unknown> = {}) {
  return {
    conceptId: 'docs/intro.md',
    title: 'intro.md',
    itemType: 'file',
    totalChars: 11,
    charStart: 0,
    charEnd: 11,
    content: 'hello world',
    truncated: false,
    ...overrides
  }
}

describe('kb_read', () => {
  beforeEach(() => {
    readConcept.mockReset()
    loggerWarn.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_READ_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('always')
  })

  it('returns an error and does not read when the base is outside the assistant scope', async () => {
    const result = (await callExecute(
      { baseId: 'kb-other', conceptId: 'docs/intro.md' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-other')
    expect(readConcept).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('reads an in-scope base, forwarding the range and mapping itemType → type', async () => {
    readConcept.mockResolvedValue(conceptContent())

    const result = await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/intro.md', charStart: 0, charEnd: 11 },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(readConcept).toHaveBeenCalledWith('kb-1', 'docs/intro.md', { charStart: 0, charEnd: 11 })
    expect(result).toEqual({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      type: 'file',
      totalChars: 11,
      charStart: 0,
      charEnd: 11,
      content: 'hello world',
      truncated: false
    })
  })

  it('reads unscoped when the assistant has no knowledge scope', async () => {
    readConcept.mockResolvedValue(conceptContent())

    await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/intro.md' },
      { assistant: makeAssistant({ knowledgeBaseIds: [] }) }
    )

    expect(readConcept).toHaveBeenCalledWith('kb-1', 'docs/intro.md', { charStart: undefined, charEnd: undefined })
  })

  it('maps a NOT_FOUND into a steer to re-check the conceptId (not a raw throw)', async () => {
    readConcept.mockRejectedValue(DataApiErrorFactory.notFound('Knowledge concept', 'docs/gone.md'))

    const result = (await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/gone.md' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('docs/gone.md')
    expect(result.error).toContain('conceptId')
  })

  it('steers a missing-base NOT_FOUND to kb_list instead of blaming the conceptId', async () => {
    // The base check runs before the concept lookup, so a gone base surfaces as a 'KnowledgeBase'
    // NOT_FOUND — it must not be reported as a bad conceptId (it would send the model re-checking ids).
    readConcept.mockRejectedValue(DataApiErrorFactory.notFound('KnowledgeBase', 'kb-gone'))

    const result = (await callExecute(
      { baseId: 'kb-gone', conceptId: 'docs/intro.md' },
      { assistant: makeAssistant({ knowledgeBaseIds: [] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-gone')
    expect(result.error).toContain('kb_list')
    expect(result.error).not.toContain('conceptId')
  })

  it('surfaces a service error message', async () => {
    readConcept.mockRejectedValue(new Error('vector store down'))

    const result = (await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/intro.md' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toBe('vector store down')
  })

  describe('toModelOutput', () => {
    const toModelOutput = entry.tool.toModelOutput as (opts: {
      toolCallId: string
      input: ReadArgs
      output: unknown
    }) => { type: string; value: unknown }

    it('passes a successful read through as json', () => {
      const output = conceptContent({ itemType: undefined, type: 'file' })
      const result = toModelOutput({ toolCallId: 'tc-1', input: { baseId: 'kb-1', conceptId: 'x' }, output })
      expect(result).toEqual({ type: 'json', value: output })
    })

    it('renders an error as text', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1', conceptId: 'x' },
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
