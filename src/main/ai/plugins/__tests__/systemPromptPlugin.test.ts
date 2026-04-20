import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the dependency modules BEFORE importing the plugin so the factory
// picks up the mocked `replacePromptVariables` / `getHubModeSystemPrompt`.
vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input.replace('{{date}}', '2026-04-20'))
}))

vi.mock('../../prompts/hubMode', () => ({
  getHubModeSystemPrompt: vi.fn(() => '## Hub MCP Tools – Auto Tooling Mode\n...')
}))

import { createSystemPromptPlugin } from '../systemPromptPlugin'

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

const model = { id: 'gpt-4', providerId: 'openai', name: 'GPT-4' } as Model

describe('systemPromptPlugin', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty patch when assistant.prompt is empty and mcpMode is not auto', async () => {
    const plugin = createSystemPromptPlugin({
      assistant: makeAssistant({ prompt: '', settings: { ...makeAssistant().settings, mcpMode: 'disabled' } }),
      model
    })
    const patch = await plugin.transformParams!({} as never, {} as never)
    expect(patch).toEqual({})
  })

  it('resolves template variables in assistant.prompt', async () => {
    const plugin = createSystemPromptPlugin({
      assistant: makeAssistant({
        prompt: 'Today is {{date}}',
        settings: { ...makeAssistant().settings, mcpMode: 'disabled' }
      }),
      model
    })
    const patch = (await plugin.transformParams!({} as never, {} as never)) as { system?: string }
    expect(patch.system).toBe('Today is 2026-04-20')
  })

  it('appends hub-mode prompt when mcpMode is auto', async () => {
    const plugin = createSystemPromptPlugin({
      assistant: makeAssistant({ prompt: 'base prompt' }),
      model
    })
    const patch = (await plugin.transformParams!({} as never, {} as never)) as { system?: string }
    expect(patch.system).toContain('base prompt')
    expect(patch.system).toContain('Hub MCP Tools – Auto Tooling Mode')
    expect(patch.system).toContain('base prompt\n\n##')
  })

  it('uses hub-mode prompt alone when assistant.prompt is empty and mcpMode is auto', async () => {
    const plugin = createSystemPromptPlugin({
      assistant: makeAssistant({ prompt: '' }),
      model
    })
    const patch = (await plugin.transformParams!({} as never, {} as never)) as { system?: string }
    expect(patch.system).toContain('Hub MCP Tools – Auto Tooling Mode')
    expect(patch.system?.startsWith('##')).toBe(true)
  })

  it('does NOT append hub-mode when mcpMode is manual / disabled', async () => {
    const plugin = createSystemPromptPlugin({
      assistant: makeAssistant({
        prompt: 'base',
        settings: { ...makeAssistant().settings, mcpMode: 'manual' }
      }),
      model
    })
    const patch = (await plugin.transformParams!({} as never, {} as never)) as { system?: string }
    expect(patch.system).toBe('base')
  })
})
