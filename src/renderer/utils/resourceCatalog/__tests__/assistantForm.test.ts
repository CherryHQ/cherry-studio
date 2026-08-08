import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { describe, expect, it } from 'vitest'

import { initialAssistantFormState } from '../assistantForm'

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'asst-1',
    name: 'Assistant',
    prompt: '',
    emoji: '🌟',
    description: '',
    settings: { ...DEFAULT_ASSISTANT_SETTINGS } as AssistantSettings,
    modelId: null,
    groupId: null,
    orderKey: 'a0',
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    modelName: null,
    ...overrides
  }
}

describe('initialAssistantFormState', () => {
  it('copies columns + flattens settings into the form state', () => {
    const assistant = createAssistant({
      name: 'Demo',
      emoji: '🧠',
      description: 'd',
      prompt: 'hello',
      modelId: 'openai::gpt-5',
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        temperature: 0.7,
        enableTemperature: true,
        mcpMode: 'manual'
      } as AssistantSettings,
      knowledgeBaseIds: ['kb-1'],
      mcpServerIds: ['mcp-1']
    })

    const form = initialAssistantFormState(assistant)

    expect(form).toMatchObject({
      name: 'Demo',
      emoji: '🧠',
      description: 'd',
      prompt: 'hello',
      modelId: 'openai::gpt-5',
      temperature: 0.7,
      enableTemperature: true,
      mcpMode: 'manual',
      knowledgeBaseIds: ['kb-1'],
      mcpServerIds: ['mcp-1']
    })
  })

  it('copies the canonical group id', () => {
    const groupId = '11111111-1111-4111-8111-111111111111'
    const assistant = createAssistant({ groupId })
    expect(initialAssistantFormState(assistant).groupId).toBe(groupId)
  })

  it.each([true, 'legacy-mode'])('normalizes an invalid runtime MCP mode (%s) to the default', (mcpMode) => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        mcpMode
      } as unknown as AssistantSettings
    })

    expect(initialAssistantFormState(assistant).mcpMode).toBe(DEFAULT_ASSISTANT_SETTINGS.mcpMode)
  })
})

describe('initialAssistantFormState context override', () => {
  it('treats a null contextSettings as override-off (inherit)', () => {
    const assistant = createAssistant({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSettings: null } as AssistantSettings
    })
    expect(initialAssistantFormState(assistant).contextOverrideEnabled).toBe(false)
  })

  it('turns a stored contextSettings object into the override fields', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        contextSettings: { truncateThreshold: 8000, compress: { enabled: false, modelId: 'anthropic::c' } }
      } as AssistantSettings
    })

    expect(initialAssistantFormState(assistant)).toMatchObject({
      contextOverrideEnabled: true,
      contextTruncateThreshold: 8000,
      contextCompressEnabled: false,
      contextCompressModelId: 'anthropic::c'
    })
  })
})
