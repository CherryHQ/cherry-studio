import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { ToolSet } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Assistant, AssistantReplyLanguage } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input.replace('{{date}}', '2026-04-20'))
}))

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
      streamOutput: true,
      reasoning_effort: 'default',
      mcpMode: 'auto',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: []
    },
    ...overrides
  } as Assistant
}

const model = { id: 'openai::gpt-4' as UniqueModelId, providerId: 'openai', name: 'GPT-4' } as Model

describe('assembleSystemPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves template variables in assistant.prompt', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'Today is {{date}}' }),
      model
    })
    expect(out).toBe('Today is 2026-04-20')
  })

  it('returns just the assistant prompt when no tool_search is present, regardless of mcpMode', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base', settings: { ...makeAssistant().settings, mcpMode: 'auto' } }),
      model
    })
    expect(out).toBe('base')
  })

  it('appends deferred-tools workflow guidance when tools includes tool_search', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: 'base' }),
      model,
      tools: { tool_search: {} } as unknown as ToolSet
    })
    expect(out).toContain('base')

    // tool_exec is intentionally NOT advertised to the model (privilege-escalation surface).
  })

  describe('reply language', () => {
    const withLanguage = (replyLanguage?: AssistantReplyLanguage) =>
      makeAssistant({ prompt: 'base', settings: { ...makeAssistant().settings, replyLanguage } })

    afterEach(() => MockMainPreferenceServiceUtils.resetMocks())

    it('asks for the language the Assistant names', async () => {
      const out = await assembleSystemPrompt({
        assistant: withLanguage({ mode: 'custom', language: 'Deutsch' }),
        model
      })

      expect(out).toMatch(/^base\n\n.*respond in Deutsch\./)
    })

    it('follows the global reply language when the Assistant inherits it', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('agent.language', '日本語')

      const out = await assembleSystemPrompt({ assistant: withLanguage({ mode: 'inherit' }), model })

      expect(out).toContain('respond in 日本語.')
    })

    it.each([
      { name: 'an Assistant saved before the setting existed', replyLanguage: undefined },
      { name: 'no constraint', replyLanguage: { mode: 'off' } as const },
      { name: 'inheriting while no global language is set', replyLanguage: { mode: 'inherit' } as const, global: null }
    ])('adds nothing for $name', async ({ replyLanguage, global = 'English' }) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('agent.language', global)

      const out = await assembleSystemPrompt({ assistant: withLanguage(replyLanguage), model })

      expect(out).toBe('base')
    })
  })
})
