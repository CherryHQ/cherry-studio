import { type Model, MODEL_CAPABILITY, type ModelCapability, type RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  canModelUseAssistantWebSearch,
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
  it('rejects enabled web search when the next model cannot consume it', () => {
    const nextModel = createModel()

    expect(canModelUseAssistantWebSearch(nextModel)).toBe(false)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true })).toEqual({
      enableWebSearch: false
    })
  })

  it('keeps enabled web search for function-calling models', () => {
    const nextModel = createModel([MODEL_CAPABILITY.FUNCTION_CALL])

    expect(canModelUseAssistantWebSearch(nextModel)).toBe(true)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true })).toBeNull()
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
