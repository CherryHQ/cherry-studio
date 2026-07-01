import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const addItems = vi.fn()
const deleteConcepts = vi.fn()
const refreshConcepts = vi.fn()
const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { addItems, deleteConcepts, refreshConcepts }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import { createKbManageToolEntry, KB_MANAGE_TOOL_NAME } from '../KnowledgeManageTool'

const entry = createKbManageToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return { id: 'assistant-1', knowledgeBaseIds: [], ...overrides } as Assistant
}

type ManageArgs = {
  baseId: string
  action: 'add' | 'delete' | 'refresh'
  type?: 'file' | 'url' | 'note'
  path?: string
  url?: string
  content?: string
  title?: string
  conceptIds?: string[]
}

function callExecute(args: ManageArgs, ctx: { assistant?: Assistant } = {}): Promise<unknown> {
  const execute = entry.tool.execute as (args: ManageArgs, options: ToolExecutionOptions) => Promise<unknown>
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

describe('kb_manage', () => {
  beforeEach(() => {
    addItems.mockReset()
    deleteConcepts.mockReset()
    refreshConcepts.mockReset()
    loggerWarn.mockReset()
    addItems.mockResolvedValue({ status: 'added' })
    deleteConcepts.mockResolvedValue({ applied: [], notFound: [] })
    refreshConcepts.mockResolvedValue({ applied: [], notFound: [] })
  })

  it('builds an entry with the agreed namespace + defer policy and is approval-gated', () => {
    expect(entry.name).toBe(KB_MANAGE_TOOL_NAME)
    expect(entry.namespace).toBe('kb')
    expect(entry.defer).toBe('always')
    // Every action mutates the base, so the tool must require user approval.
    expect(entry.tool.needsApproval).toBe(true)
  })

  it('returns an error and does not mutate when the base is outside the assistant scope', async () => {
    const result = (await callExecute(
      { baseId: 'kb-other', action: 'delete', conceptIds: ['docs/a.md'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-other')
    expect(deleteConcepts).not.toHaveBeenCalled()
  })

  it('adds a file by absolute path, deriving the source name from the basename', async () => {
    const result = await callExecute(
      { baseId: 'kb-1', action: 'add', type: 'file', path: '/Users/me/docs/report.pdf' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(addItems).toHaveBeenCalledWith('kb-1', [
      { type: 'file', data: { source: 'report.pdf', path: '/Users/me/docs/report.pdf' } }
    ])
    expect(result).toEqual({ action: 'add', added: ['report.pdf'] })
  })

  it('rejects a non-absolute file path via schema validation and does not add', async () => {
    const result = (await callExecute(
      { baseId: 'kb-1', action: 'add', type: 'file', path: 'relative/report.pdf' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('Invalid knowledge item to add')
    // Assert the rejection reason is absoluteness specifically — so the test can't pass for the wrong
    // reason (e.g. a future required field going missing) while absolute-path enforcement silently drops.
    expect(result.error).toContain('absolute')
    expect(addItems).not.toHaveBeenCalled()
  })

  it('adds a url, using the url as its source', async () => {
    const result = await callExecute(
      { baseId: 'kb-1', action: 'add', type: 'url', url: 'https://example.com/post' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(addItems).toHaveBeenCalledWith('kb-1', [
      { type: 'url', data: { source: 'https://example.com/post', url: 'https://example.com/post' } }
    ])
    expect(result).toEqual({ action: 'add', added: ['https://example.com/post'] })
  })

  it('adds a note, deriving the source from the first line when no title is given', async () => {
    const result = await callExecute(
      { baseId: 'kb-1', action: 'add', type: 'note', content: 'First line\nsecond line' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(addItems).toHaveBeenCalledWith('kb-1', [
      { type: 'note', data: { source: 'First line', content: 'First line\nsecond line' } }
    ])
    expect(result).toEqual({ action: 'add', added: ['First line'] })
  })

  it('returns a steer and does not add when a required add field is missing', async () => {
    const result = (await callExecute(
      { baseId: 'kb-1', action: 'add', type: 'file' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('path')
    expect(addItems).not.toHaveBeenCalled()
  })

  it('deletes documents by conceptId, forwarding the result', async () => {
    deleteConcepts.mockResolvedValue({ applied: ['docs/a.md'], notFound: ['docs/gone.md'] })

    const result = await callExecute(
      { baseId: 'kb-1', action: 'delete', conceptIds: ['docs/a.md', 'docs/gone.md'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(deleteConcepts).toHaveBeenCalledWith('kb-1', ['docs/a.md', 'docs/gone.md'])
    expect(result).toEqual({ action: 'delete', deleted: ['docs/a.md'], notFound: ['docs/gone.md'] })
  })

  it('refreshes documents by conceptId, forwarding the result', async () => {
    refreshConcepts.mockResolvedValue({ applied: ['docs/a.md'], notFound: [] })

    const result = await callExecute(
      { baseId: 'kb-1', action: 'refresh', conceptIds: ['docs/a.md'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )

    expect(refreshConcepts).toHaveBeenCalledWith('kb-1', ['docs/a.md'])
    expect(result).toEqual({ action: 'refresh', refreshed: ['docs/a.md'], notFound: [] })
  })

  it('returns a steer and does not delete when conceptIds are missing', async () => {
    const result = (await callExecute(
      { baseId: 'kb-1', action: 'delete' },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-1'] }) }
    )) as { error: string }

    expect(result.error).toContain('conceptIds')
    expect(deleteConcepts).not.toHaveBeenCalled()
  })

  it('maps a NOT_FOUND base to a steer toward kb_list', async () => {
    deleteConcepts.mockRejectedValue(DataApiErrorFactory.notFound('Knowledge base', 'kb-gone'))

    const result = (await callExecute(
      { baseId: 'kb-gone', action: 'delete', conceptIds: ['docs/a.md'] },
      { assistant: makeAssistant({ knowledgeBaseIds: ['kb-gone'] }) }
    )) as { error: string }

    expect(result.error).toContain('kb-gone')
    expect(result.error).toContain('kb_list')
  })

  describe('toModelOutput', () => {
    const toModelOutput = entry.tool.toModelOutput as (opts: {
      toolCallId: string
      input: ManageArgs
      output: unknown
    }) => { type: string; value: unknown }

    it('passes a success result through as json', () => {
      const output = { action: 'delete', deleted: ['docs/a.md'], notFound: [] }
      const result = toModelOutput({ toolCallId: 'tc-1', input: { baseId: 'kb-1', action: 'delete' }, output })
      expect(result).toEqual({ type: 'json', value: output })
    })

    it('renders an error as text', () => {
      const result = toModelOutput({
        toolCallId: 'tc-1',
        input: { baseId: 'kb-1', action: 'delete' },
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
