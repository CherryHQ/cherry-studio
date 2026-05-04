import type { Assistant } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { ToolSet } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input.replace('{{date}}', '2026-04-20'))
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { assembleSystemPrompt } from '../assembleSystemPrompt'

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    prompt: 'hello',
    mcpServerIds: [],
    settings: {
      temperature: 1,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      contextCount: 5,
      streamOutput: true,
      reasoning_effort: 'default',
      qwenThinkMode: false,
      mcpMode: 'auto',
      toolUseMode: 'function',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: []
    },
    ...overrides
  } as Assistant
}

const model = { id: 'openai::gpt-4' as UniqueModelId, providerId: 'openai', name: 'GPT-4' } as Model

// Identity prose is always emitted as the first section. Tests that
// previously did `toBe('base')` now have to allow for that prefix; we
// assert containment + structure rather than exact equality.
const IDENTITY_MARKER = 'You are an AI assistant running inside Cherry Studio'

describe('assembleSystemPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('always emits the identity section even when no assistant is supplied', async () => {
    const out = await assembleSystemPrompt({ model })
    expect(out).toContain(IDENTITY_MARKER)
  })

  it('emits identity even when assistant.prompt is empty', async () => {
    const out = await assembleSystemPrompt({ assistant: makeAssistant({ prompt: '' }), model })
    expect(out).toContain(IDENTITY_MARKER)
  })

  it('resolves template variables in assistant.prompt', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'Today is {{date}}' }),
      model
    })
    expect(out).toContain('Today is 2026-04-20')
  })

  it('places assistant_prompt after identity', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base' }),
      model
    })
    expect(out).toBeDefined()
    const text = out as string
    expect(text.indexOf(IDENTITY_MARKER)).toBeLessThan(text.indexOf('base'))
  })

  it('appends deferred-tools workflow guidance when tools includes tool_search', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base' }),
      model,
      tools: { tool_search: {} } as unknown as ToolSet
    })
    expect(out).toContain('base')
    expect(out).toContain('<deferred-tools>')
    expect(out).toContain('</deferred-tools>')
    expect(out).toContain('tool_invoke')
  })

  it('lists deferred namespaces with counts when deferredEntries is supplied', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base' }),
      model,
      tools: { tool_search: {} } as unknown as ToolSet,
      deferredEntries: [
        { name: 'mcp__gh__a', namespace: 'mcp:gh' },
        { name: 'mcp__gh__b', namespace: 'mcp:gh' },
        { name: 'mcp__gmail__c', namespace: 'mcp:gmail' }
      ] as never
    })
    expect(out).toContain('<namespaces>')
    expect(out).toContain('<namespace name="mcp:gh" count="2"/>')
    expect(out).toContain('<namespace name="mcp:gmail" count="1"/>')
  })

  it('does not append deferred-tools guidance when tool_search is absent', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base' }),
      model,
      tools: { other_tool: {} } as unknown as ToolSet
    })
    expect(out).toContain('base')
    expect(out).not.toContain('<deferred-tools>')
  })
})
