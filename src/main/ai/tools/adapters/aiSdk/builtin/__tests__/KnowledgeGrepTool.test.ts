import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const grepConcept = vi.fn()
const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { grepConcept }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import { createKbGrepToolEntry, KB_GREP_TOOL_NAME } from '../KnowledgeGrepTool'

const entry = createKbGrepToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return { id: 'assistant-1', knowledgeBaseIds: [], ...overrides } as Assistant
}

type GrepArgs = { baseId: string; conceptId: string; pattern: string; ignoreCase?: boolean; maxMatches?: number }

function callExecute(args: GrepArgs, ctx: { assistant?: Assistant } = {}): Promise<unknown> {
  const execute = entry.tool.execute as (args: GrepArgs, options: ToolExecutionOptions) => Promise<unknown>
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

function grepResult(overrides: Record<string, unknown> = {}) {
  return {
    conceptId: 'docs/intro.md',
    title: 'intro.md',
    itemType: 'note',
    totalMatches: 1,
    matches: [{ line: 2, charStart: 9, charEnd: 14, snippet: 'match' }],
    ...overrides
  }
}

describe('kb_grep', () => {
  beforeEach(() => {
    grepConcept.mockReset()
    loggerWarn.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(KB_GREP_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('always')
  })

  it('returns an error and does not grep when the base is outside the assistant scope', async () => {
    const result = (await callExecute(
      { baseId: 'kb-other', conceptId: 'docs/intro.md', pattern: 'x' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-other')
    expect(grepConcept).not.toHaveBeenCalled()
  })

  it('greps an in-scope base, forwarding options and mapping itemType → type', async () => {
    grepConcept.mockResolvedValue(grepResult())

    const result = await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/intro.md', pattern: 'match', ignoreCase: false, maxMatches: 10 },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(grepConcept).toHaveBeenCalledWith('kb-1', 'docs/intro.md', {
      pattern: 'match',
      ignoreCase: false,
      maxMatches: 10
    })
    expect(result).toEqual({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      type: 'note',
      totalMatches: 1,
      matches: [{ line: 2, charStart: 9, charEnd: 14, snippet: 'match' }]
    })
  })

  it('surfaces an invalid-pattern validation error message', async () => {
    grepConcept.mockRejectedValue(
      DataApiErrorFactory.validation(
        { pattern: ['Invalid regular expression'] },
        'Invalid kb_grep regular expression: ('
      )
    )

    const result = (await callExecute(
      { baseId: 'kb-1', conceptId: 'docs/intro.md', pattern: '(' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('Invalid kb_grep regular expression')
  })

  it('steers a missing-base NOT_FOUND to kb_list instead of blaming the conceptId', async () => {
    // A gone base surfaces as a 'KnowledgeBase' NOT_FOUND from the pre-lookup base check; it must not
    // be reported as a bad conceptId, which would send the model re-checking ids that were never wrong.
    grepConcept.mockRejectedValue(DataApiErrorFactory.notFound('KnowledgeBase', 'kb-gone'))

    const result = (await callExecute(
      { baseId: 'kb-gone', conceptId: 'docs/intro.md', pattern: 'x' },
      { assistant: makeAssistant({ knowledgeBaseIds: [] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-gone')
    expect(result.error).toContain('kb_list')
    expect(result.error).not.toContain('conceptId')
  })

  describe('toModelOutput', () => {
    const toModelOutput = entry.tool.toModelOutput as (opts: {
      toolCallId: string
      input: GrepArgs
      output: unknown
    }) => { type: string; value: unknown }

    it('passes matches through as json', () => {
      const output = grepResult({ itemType: undefined, type: 'note' })
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1', conceptId: 'x', pattern: 'y' },
        output
      })
      expect(result).toEqual({ type: 'json', value: output })
    })

    it('returns a no-matches hint as text when there are zero matches', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1', conceptId: 'x', pattern: 'y' },
        output: grepResult({ totalMatches: 0, matches: [] })
      })
      expect(result.type).toBe('text')
      expect(result.value).toMatch(/No matches/)
    })

    it('renders an error as text', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1', conceptId: 'x', pattern: 'y' },
        output: { error: 'nope' }
      })
      expect(result).toEqual({ type: 'text', value: 'nope' })
    })
  })

  describe('applies', () => {
    it('returns true only when a base exists AND at least one is bound to the assistant', () => {
      const applies = entry.applies!
      // No base in the system → never applies, even with bound ids.
      expect(
        applies({
          assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }),
          mcpToolIds: new Set(),
          hasAnyKnowledgeBase: false
        })
      ).toBe(false)
      // A base exists but none bound to this assistant → does not apply.
      expect(applies({ assistant: undefined, mcpToolIds: new Set(), hasAnyKnowledgeBase: true })).toBe(false)
      expect(
        applies({
          assistant: makeAssistant({ knowledgeBaseIds: [] }),
          mcpToolIds: new Set(),
          hasAnyKnowledgeBase: true
        })
      ).toBe(false)
      // A base exists AND is bound → applies.
      expect(
        applies({
          assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }),
          mcpToolIds: new Set(),
          hasAnyKnowledgeBase: true
        })
      ).toBe(true)
    })
  })
})
