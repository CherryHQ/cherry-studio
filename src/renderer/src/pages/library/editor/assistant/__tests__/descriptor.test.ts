import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Tag } from '@shared/data/types/tag'
import { describe, expect, it } from 'vitest'

import {
  buildCreateAssistantFormState,
  buildCreateAssistantPayload,
  diffAssistantSaveIntent,
  diffAssistantUpdate,
  initialAssistantFormState,
  isCreateAssistantPayloadValid,
  validateAssistantCreateForm
} from '../descriptor'

function tag(id: string, name: string, color = '#888'): Tag {
  return {
    id,
    name,
    color,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z'
  }
}

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'asst-1',
    name: 'Assistant',
    prompt: '',
    emoji: '🌟',
    description: '',
    settings: { ...DEFAULT_ASSISTANT_SETTINGS } as AssistantSettings,
    modelId: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    tags: [],
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

  it('extracts tag names from embedded tag rows', () => {
    const assistant = createAssistant({ tags: [tag('t1', 'alpha', '#f00'), tag('t2', 'beta', '#0f0')] })
    expect(initialAssistantFormState(assistant).tags).toEqual(['alpha', 'beta'])
  })
})

describe('assistant create flow helpers', () => {
  it('starts from an unsaved draft shape with empty required fields', () => {
    expect(buildCreateAssistantFormState()).toMatchObject({
      name: '',
      prompt: '',
      emoji: '💬',
      description: '',
      modelId: undefined,
      tags: [],
      knowledgeBaseIds: [],
      mcpServerIds: []
    })
  })

  it('requires both name and prompt before the first save is allowed', () => {
    const draft = buildCreateAssistantFormState()

    expect(isCreateAssistantPayloadValid(draft)).toBe(false)
    expect(isCreateAssistantPayloadValid({ ...draft, name: 'Assistant' })).toBe(false)
    expect(isCreateAssistantPayloadValid({ ...draft, prompt: 'You are helpful.' })).toBe(false)
    expect(isCreateAssistantPayloadValid({ ...draft, name: 'Assistant', prompt: 'You are helpful.' })).toBe(true)
  })

  it('reports missing required fields individually for page-level validation', () => {
    const draft = buildCreateAssistantFormState()

    expect(validateAssistantCreateForm(draft)).toEqual({
      nameMissing: true,
      promptMissing: true,
      isValid: false
    })
    expect(validateAssistantCreateForm({ ...draft, name: 'Assistant' })).toEqual({
      nameMissing: false,
      promptMissing: true,
      isValid: false
    })
  })

  it('keeps create mode unsaveable until required fields are filled', () => {
    const baseline = buildCreateAssistantFormState()

    expect(diffAssistantSaveIntent({ ...baseline, name: 'Assistant' }, baseline, null)).toBeNull()
    expect(diffAssistantSaveIntent({ ...baseline, prompt: 'You are helpful.' }, baseline, null)).toBeNull()
  })

  it('builds the initial create payload only after name and prompt are provided', () => {
    const baseline = buildCreateAssistantFormState()
    const form = {
      ...baseline,
      name: '  Assistant  ',
      prompt: 'You are helpful.',
      description: 'demo',
      tags: ['alpha', 'beta'],
      knowledgeBaseIds: ['kb-1'],
      mcpServerIds: ['mcp-1']
    }

    expect(buildCreateAssistantPayload(form)).toMatchObject({
      name: 'Assistant',
      prompt: 'You are helpful.',
      emoji: '💬',
      description: 'demo',
      knowledgeBaseIds: ['kb-1'],
      mcpServerIds: ['mcp-1']
    })
    expect(buildCreateAssistantPayload(form)).not.toHaveProperty('modelId')

    expect(diffAssistantSaveIntent(form, baseline, null)).toEqual({
      kind: 'create',
      payload: buildCreateAssistantPayload(form),
      tagNames: ['alpha', 'beta']
    })
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
    expect(result!.tagsChanged).toBe(false)
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
        // `reasoning_effort` is a settings key the library editor never
        // touches — it MUST survive a columns PATCH.
        reasoning_effort: 'high'
      } as AssistantSettings
    })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, prompt: 'updated' }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.dto.settings).toMatchObject({ reasoning_effort: 'high' })
  })

  it('flags tag changes and passes form.tags through as tagNames', () => {
    const assistant = createAssistant({ tags: [tag('t1', 'alpha', '#f00')] })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, tags: ['alpha', 'new'] }

    const result = diffAssistantUpdate(form, baseline, assistant)
    expect(result?.tagsChanged).toBe(true)
    expect(result?.tagNames).toEqual(['alpha', 'new'])
  })

  it('treats tag reorder (same set) as unchanged', () => {
    const assistant = createAssistant({ tags: [tag('t1', 'alpha', '#f00'), tag('t2', 'beta', '#0f0')] })
    const baseline = initialAssistantFormState(assistant)
    const form = { ...baseline, tags: ['beta', 'alpha'] }

    expect(diffAssistantUpdate(form, baseline, assistant)).toBeNull()
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
})
