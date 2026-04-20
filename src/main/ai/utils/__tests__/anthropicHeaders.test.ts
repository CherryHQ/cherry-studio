import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { addAnthropicHeaders } from '../anthropicHeaders'

function makeAssistant(settings: Partial<Assistant['settings']> = {}): Assistant {
  return {
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
      customParameters: [],
      ...settings
    }
  } as Assistant
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return { id: 'claude-sonnet-4-5-20250101', providerId: 'anthropic', name: 'Claude 4.5 Sonnet', ...overrides } as Model
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return { id: 'anthropic', name: 'Anthropic', ...overrides } as Provider
}

describe('addAnthropicHeaders', () => {
  it('adds interleaved-thinking beta for Claude 4.5 reasoning + function tool use on direct Anthropic', () => {
    const headers = addAnthropicHeaders(makeAssistant({ toolUseMode: 'function' }), makeModel(), makeProvider())
    expect(headers).toContain('interleaved-thinking-2025-05-14')
  })

  it('skips interleaved-thinking when tool use mode is `prompt`', () => {
    const headers = addAnthropicHeaders(makeAssistant({ toolUseMode: 'prompt' }), makeModel(), makeProvider())
    expect(headers).not.toContain('interleaved-thinking-2025-05-14')
  })

  it('skips interleaved-thinking on Bedrock', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ toolUseMode: 'function' }),
      makeModel(),
      makeProvider({ id: 'aws-bedrock', presetProviderId: 'aws-bedrock' })
    )
    expect(headers).not.toContain('interleaved-thinking-2025-05-14')
  })

  it('adds web-search beta for Claude 4 series on Vertex when web search is enabled', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ enableWebSearch: true }),
      makeModel({ id: 'claude-sonnet-4-20250101' }),
      makeProvider({ id: 'google-vertex', presetProviderId: 'google-vertex' })
    )
    expect(headers).toContain('web-search-2025-03-05')
  })

  it('does NOT add web-search on Vertex when web search is disabled', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ enableWebSearch: false }),
      makeModel({ id: 'claude-sonnet-4-20250101' }),
      makeProvider({ id: 'google-vertex', presetProviderId: 'google-vertex' })
    )
    expect(headers).not.toContain('web-search-2025-03-05')
  })

  it('returns an empty list for non-qualifying model/provider combos', () => {
    const headers = addAnthropicHeaders(
      makeAssistant(),
      makeModel({ id: 'gpt-4', providerId: 'openai' }),
      makeProvider({ id: 'openai' })
    )
    expect(headers).toEqual([])
  })
})
