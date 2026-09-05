import { UpdateAssistantSchema } from '@shared/data/api/schemas/assistants'
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
      enableRuntimeContext: true,
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

  it('keeps runtime context disabled for legacy settings without the toggle', () => {
    const legacySettings = { ...DEFAULT_ASSISTANT_SETTINGS }
    delete legacySettings.enableRuntimeContext

    const assistant = createAssistant({ settings: legacySettings })

    expect(initialAssistantFormState(assistant).enableRuntimeContext).toBe(false)
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

describe('diffAssistantUpdate', () => {
  it('returns null when nothing changed', () => {
    const assistant = createAssistant()
    const baseline = initialAssistantFormState(assistant)
    expect(diffAssistantUpdate(baseline, baseline, assistant)).toBeNull()
  })

  it('emits only the changed column field', () => {
    const assistant = createAssistant({ name: 'Original' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, description: 'edited' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto).toEqual({ description: 'edited' })
  })

  it('does not resend an invalid legacy MCP mode when editing an unrelated field', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        mcpMode: true
      } as unknown as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, description: 'edited' }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(result?.dto).toEqual({ description: 'edited' })
    expect(UpdateAssistantSchema.safeParse(result?.dto).success).toBe(true)
  })

  it('renames an assistant without resending invalid legacy settings', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        maxTokens: 0
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, name: 'Renamed' }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(result?.dto).toEqual({ name: 'Renamed' })
    expect(UpdateAssistantSchema.safeParse(result?.dto).success).toBe(true)
  })

  it('repairs invalid legacy max tokens when enabling the limit', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        maxTokens: 0,
        enableMaxTokens: false
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, enableMaxTokens: true }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(baseline.maxTokens).toBe(DEFAULT_ASSISTANT_SETTINGS.maxTokens)
    expect(result?.dto).toEqual({
      settings: {
        maxTokens: DEFAULT_ASSISTANT_SETTINGS.maxTokens,
        enableMaxTokens: true
      }
    })
    expect(UpdateAssistantSchema.safeParse(result?.dto).success).toBe(true)
    expect({ ...assistant.settings, ...result?.dto.settings }).toMatchObject({
      maxTokens: DEFAULT_ASSISTANT_SETTINGS.maxTokens,
      enableMaxTokens: true
    })
  })

  it('emits only the changed settings key', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        maxTokens: 0
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, temperature: 0.5 }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(result?.dto).toEqual({ settings: { temperature: 0.5 } })
    expect(UpdateAssistantSchema.safeParse(result?.dto).success).toBe(true)
  })

  it('falls back to the server name when the form name is blank', () => {
    const assistant = createAssistant({ name: 'Original' })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, name: '   ', description: 'd' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.name).toBe('Original')
  })

  it('leaves server-side settings keys the UI does not surface out of column patches', () => {
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
    expect(result?.dto).toEqual({ prompt: 'updated' })
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
    const assistant = createAssistant({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableRuntimeContext: false } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, enableRuntimeContext: true, runtimeContextPrompt: 'Custom runtime context' }

    const result = diffAssistantUpdate(form, baseline, assistant)

    expect(result?.dto.settings?.enableRuntimeContext).toBe(true)
    expect(result?.dto.settings?.runtimeContextPrompt).toBe('Custom runtime context')
  })
})

describe('context-management override (P2-D)', () => {
  it('seeds the override-off state when no contextSettings are stored', () => {
    const form = initialAssistantFormState(createAssistant())
    expect(form.contextOverrideEnabled).toBe(false)
    expect(form.contextCompressModelId).toBeNull()
  })

  it('seeds the override-on state from a stored contextSettings object', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        contextSettings: {
          truncateThreshold: 4000,
          compress: { enabled: false, modelId: 'openai::c', thresholdPercent: 65 }
        }
      } as AssistantSettings
    })
    const form = initialAssistantFormState(assistant)
    expect(form.contextOverrideEnabled).toBe(true)
    expect(form.contextTruncateThreshold).toBe(4000)
    expect(form.contextCompressEnabled).toBe(false)
    expect(form.contextCompressModelId).toBe('openai::c')
    expect(form.contextCompressThresholdPercent).toBe(65)
  })

  it('treats a null contextSettings as override-off (inherit)', () => {
    const assistant = createAssistant({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSettings: null } as AssistantSettings
    })
    expect(initialAssistantFormState(assistant).contextOverrideEnabled).toBe(false)
  })

  it('writes contextSettings: null when the override is turned off', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        contextSettings: { truncateThreshold: 4000 }
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, contextOverrideEnabled: false }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.settings?.contextSettings).toBeNull()
  })

  it('builds the override object when the switch is on', () => {
    const baseline = initialAssistantFormState(createAssistant())
    const form = {
      ...baseline,
      contextOverrideEnabled: true,
      contextCompressEnabled: false,
      contextTruncateThreshold: 8000,
      contextCompressThresholdPercent: 60,
      contextCompressModelId: 'anthropic::c'
    }

    const result = diffAssistantUpdate(form, baseline, createAssistant())
    expect(result?.dto.settings?.contextSettings).toEqual({
      truncateThreshold: 8000,
      compress: { enabled: false, modelId: 'anthropic::c', thresholdPercent: 60 }
    })
  })

  it('persists maxMessages on its own while the offload/compression override is off', () => {
    // Scope (how much history is sent) is independent of the override switch
    // (what happens when the context overflows).
    const baseline = initialAssistantFormState(createAssistant())
    const form = { ...baseline, contextMaxMessages: 1 }

    const result = diffAssistantUpdate(form, baseline, createAssistant())
    expect(result?.dto.settings?.contextSettings).toEqual({ maxMessages: 1 })
  })

  it('reads a maxMessages-only contextSettings as override-off', () => {
    const assistant = createAssistant({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSettings: { maxMessages: 5 } } as AssistantSettings
    })
    const form = initialAssistantFormState(assistant)
    expect(form.contextOverrideEnabled).toBe(false)
    expect(form.contextMaxMessages).toBe(5)
  })

  it('clears back to null when the message limit is emptied', () => {
    const assistant = createAssistant({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSettings: { maxMessages: 5 } } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, contextMaxMessages: null }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.settings?.contextSettings).toBeNull()
  })

  // A legacy override stored before the trigger existed must keep INHERITING it.
  // Materializing the displayed value on an unrelated edit would freeze the
  // assistant at whatever the global happened to be that day.
  it('leaves an inherited trigger absent when another override field is edited', () => {
    const assistant = createAssistant({
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        contextSettings: { truncateThreshold: 4000, compress: { enabled: true } }
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    expect(baseline.contextCompressThresholdPercent).toBeNull()

    const form = { ...baseline, contextTruncateThreshold: 9000 }
    const compress = diffAssistantUpdate(form, baseline, assistant)?.dto.settings?.contextSettings?.compress
    expect(compress).toEqual({ enabled: true, modelId: null })
    expect(compress).not.toHaveProperty('thresholdPercent')
  })

  it('does not PATCH when sub-fields change while the override is off', () => {
    const baseline = initialAssistantFormState(createAssistant())
    const form = { ...baseline, contextTruncateThreshold: 999 }
    expect(diffAssistantUpdate(form, baseline, createAssistant())).toBeNull()
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
