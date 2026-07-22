import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { describe, expect, it } from 'vitest'

import { diffAssistantSaveIntent, diffAssistantUpdate, initialAssistantFormState } from '../assistantForm'

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
      enableRuntimeContext: false,
      runtimeContextPrompt: '',
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
})

describe('diffAssistantUpdate', () => {
  it('returns null when nothing changed', () => {
    const assistant = createAssistant()
    const baseline = initialAssistantFormState(assistant)
    expect(diffAssistantUpdate(baseline, baseline, assistant)).toBeNull()
  })

  it('emits the full columns+settings block when any column field changes', () => {
    const assistant = createAssistant({ name: 'Original' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, description: 'edited' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result).not.toBeNull()
    expect(result!.dto).toMatchObject({
      name: 'Original',
      emoji: assistant.emoji,
      description: 'edited',
      modelId: assistant.modelId,
      prompt: assistant.prompt,
      settings: expect.objectContaining({
        temperature: baseline.temperature,
        mcpMode: baseline.mcpMode
      })
    })
    expect(result!.dto.groupId).toBeUndefined()
  })

  it('falls back to the server name when the form name is blank', () => {
    const assistant = createAssistant({ name: 'Original' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, name: '   ', description: 'd' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.name).toBe('Original')
  })

  it('preserves server-side settings keys the UI does not surface', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        // `reasoning_effort` is a settings key the library dialog never
        // touches — it MUST survive a columns PATCH.
        reasoning_effort: 'high'
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, prompt: 'updated' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.settings).toMatchObject({ reasoning_effort: 'high' })
  })

  it('writes group changes directly into the DTO', () => {
    const originalGroupId = '11111111-1111-4111-8111-111111111111'
    const nextGroupId = '22222222-2222-4222-8222-222222222222'
    const assistant = createAssistant({ groupId: originalGroupId })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, groupId: nextGroupId }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.groupId).toBe(nextGroupId)
  })

  it('writes null when clearing the assistant group', () => {
    const assistant = createAssistant({ groupId: '11111111-1111-4111-8111-111111111111' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, groupId: null }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.groupId).toBeNull()
  })

  it('emits knowledgeBaseIds only when the set changes, ignoring order', () => {
    const assistant = createAssistant({ knowledgeBaseIds: ['a', 'b'] })
    const baseline = initialAssistantFormState(assistant)

    const reordered = { ...baseline, knowledgeBaseIds: ['b', 'a'] }
    expect(diffAssistantUpdate(reordered, baseline, assistant)).toBeNull()

    const added = { ...baseline, knowledgeBaseIds: ['a', 'b', 'c'] }
    const result = diffAssistantUpdate(added, baseline, assistant)
    expect(result?.dto.knowledgeBaseIds).toEqual(['a', 'b', 'c'])
  })

  it('emits mcpServerIds independently of the columns block', () => {
    const assistant = createAssistant({ mcpServerIds: ['m-1'] })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, mcpServerIds: ['m-1', 'm-2'] }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.mcpServerIds).toEqual(['m-1', 'm-2'])
    // No column changed → settings should NOT be in the dto.
    expect(result?.dto.settings).toBeUndefined()
    expect(result?.dto.name).toBeUndefined()
  })

  it('treats custom parameter changes as a column-block edit', () => {
    const assistant = createAssistant()
    const baseline = initialAssistantFormState(assistant)
    const form = {
      ...baseline,
      customParameters: [{ name: 'seed', type: 'number', value: 42 } as const]
    }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.settings?.customParameters).toEqual([{ name: 'seed', type: 'number', value: 42 }])
  })

  it('persists runtime context through assistant settings', () => {
    const assistant = createAssistant()
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, enableRuntimeContext: true, runtimeContextPrompt: 'Custom runtime context' }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(result?.dto.settings?.enableRuntimeContext).toBe(true)
    expect(result?.dto.settings?.runtimeContextPrompt).toBe('Custom runtime context')
  })
})

describe('diffAssistantSaveIntent', () => {
  it('wraps update diffs for the edit dialog save handler', () => {
    const assistant = createAssistant({ groupId: '11111111-1111-4111-8111-111111111111' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, groupId: '22222222-2222-4222-8222-222222222222' }

    expect(diffAssistantSaveIntent(form, baseline, assistant)).toEqual({
      kind: 'update',
      payload: { groupId: '22222222-2222-4222-8222-222222222222' }
    })
  })
})
