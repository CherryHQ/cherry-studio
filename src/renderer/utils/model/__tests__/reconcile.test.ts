import { type Model, MODEL_CAPABILITY, type ModelCapability, type RuntimeReasoning } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import {
  canModelUseAssistantWebSearch,
  hasModelBuiltinWebSearch,
  reconcileReasoningEffortForModel,
  reconcileWebSearchForModel,
  resolveReasoningEffortForModel
} from '../reconcile'

const createModel = (capabilities: ModelCapability[] = []): Model => ({
  id: 'provider::model',
  providerId: 'provider',
  apiModelId: 'model',
  name: 'Model',
  capabilities,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

const providerWith = (serverTools: Provider['serverTools']): Provider => ({ id: 'anthropic', serverTools }) as Provider

const reasoningModel = (reasoning: RuntimeReasoning): Model => ({
  ...createModel([MODEL_CAPABILITY.REASONING]),
  reasoning
})

/** Claude 4.6-style native effort vocabulary. */
const EFFORT_MAX: RuntimeReasoning = {
  controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'max'] }, { kind: 'toggle' }],
  selectableEfforts: ['low', 'medium', 'high', 'max', 'none']
}

/** Pre-4.6 claude / qwen-style toggle + budget (UI ladder low/medium/high). */
const TOGGLE_BUDGET: RuntimeReasoning = {
  controls: [{ kind: 'budget', min: 1024, max: 64_000 }, { kind: 'toggle' }],
  selectableEfforts: ['none', 'low', 'medium', 'high'],
  thinkingTokenLimits: { min: 1024, max: 64_000 }
}

/** DeepSeek hybrid-style pure toggle (on/off only). */
const TOGGLE_ONLY: RuntimeReasoning = {
  controls: [{ kind: 'toggle' }],
  selectableEfforts: ['none', 'auto']
}

describe('reconcile web search', () => {
  it('does not patch an already-disabled setting', () => {
    expect(reconcileWebSearchForModel(createModel(), { enableWebSearch: false }, undefined)).toBeNull()
  })

  it('rejects enabled web search when the next model cannot consume it', () => {
    const nextModel = createModel()

    expect(canModelUseAssistantWebSearch(nextModel, undefined)).toBe(false)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true }, undefined)).toEqual({
      enableWebSearch: false
    })
  })

  it('keeps enabled web search for function-calling models', () => {
    const nextModel = createModel([MODEL_CAPABILITY.FUNCTION_CALL])

    expect(canModelUseAssistantWebSearch(nextModel, undefined)).toBe(true)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true }, undefined)).toBeNull()
  })

  it('treats an implicitly eligible web-search model as built-in only when the provider natively serves it', () => {
    const nextModel: Model = {
      ...createModel(),
      id: 'provider::claude-sonnet-4-6',
      apiModelId: 'claude-sonnet-4-6'
    }

    expect(hasModelBuiltinWebSearch(nextModel, providerWith([]))).toBe(false)
    expect(
      hasModelBuiltinWebSearch(nextModel, providerWith([{ id: 'web-search', modelScope: 'model-dependent' }]))
    ).toBe(true)
  })

  it('treats provider-wide search as built-in for every chat model', () => {
    const nextModel = createModel()

    expect(
      hasModelBuiltinWebSearch(nextModel, providerWith([{ id: 'web-search', modelScope: 'all-chat-models' }]))
    ).toBe(true)
  })
})

describe('reconcile reasoning effort (descriptor-driven, #16598)', () => {
  it('keeps a value the next vocabulary supports', () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(EFFORT_MAX), 'high')).toBeNull()
  })

  it("effort → budget-ladder switch keeps the shared tier ('high' valid in both)", () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(TOGGLE_BUDGET), 'high')).toBeNull()
  })

  it("maps the legacy 'xhigh' alias to the adjacent native 'max' tier", () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(EFFORT_MAX), 'xhigh')).toEqual({
      reasoning_effort: 'max'
    })
  })

  it("ladder → toggle switch parks on the nearest option ('high' → 'auto')", () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(TOGGLE_ONLY), 'high')).toEqual({
      reasoning_effort: 'auto'
    })
  })

  it('switching to a knob-less model clears the effort', () => {
    const fixed = createModel([MODEL_CAPABILITY.REASONING]) // reasons, no descriptor
    expect(reconcileReasoningEffortForModel(fixed, 'high')).toEqual({ reasoning_effort: undefined })
  })

  it('undefined current effort on a capable model settles on default (no forced level)', () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(EFFORT_MAX), undefined)).toEqual({
      reasoning_effort: 'default'
    })
  })

  it('exposes the pure resolved selection for composer-local model switching', () => {
    expect(resolveReasoningEffortForModel(reasoningModel(TOGGLE_ONLY), 'high')).toBe('auto')
  })
})

describe('reconcile reasoning effort (per-model preference, #15226)', () => {
  const assistantId = 'assistant-1'
  const modelId = 'provider::model'

  it('restores the saved preference when the next model supports it', () => {
    expect(
      reconcileReasoningEffortForModel(reasoningModel(EFFORT_MAX), 'low', assistantId, { [modelId]: 'high' })
    ).toEqual({
      reasoning_effort: 'high'
    })
  })

  it('patches nothing when the saved preference already matches the current effort', () => {
    expect(
      reconcileReasoningEffortForModel(reasoningModel(EFFORT_MAX), 'high', assistantId, { [modelId]: 'high' })
    ).toBeNull()
  })

  it('ignores a saved preference the next vocabulary does not support', () => {
    expect(
      reconcileReasoningEffortForModel(reasoningModel(TOGGLE_ONLY), 'high', assistantId, { [modelId]: 'medium' })
    ).toEqual({ reasoning_effort: 'auto' })
  })

  it('falls back to standard reconciliation when no preference is recorded for the model', () => {
    expect(reconcileReasoningEffortForModel(reasoningModel(TOGGLE_BUDGET), 'high', assistantId, {})).toBeNull()
    expect(reconcileReasoningEffortForModel(reasoningModel(TOGGLE_BUDGET), 'high')).toBeNull()
  })
})
