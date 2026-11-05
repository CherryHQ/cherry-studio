import { describe, expect, it } from 'vitest'

import {
  ENDPOINT_TYPE,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability,
  type RuntimeReasoning
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  canModelUseAssistantWebSearch,
  hasModelBuiltinWebSearch,
  reconcileReasoningEffortForModel,
  reconcileWebSearchForModel,
  resolveModelSwitchSettings,
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

describe('reconcile web search + reasoning effort pair (#23582)', () => {
  /** GPT-5-style effort vocabulary including the search-incompatible 'minimal'. */
  const GPT5_REASONING: RuntimeReasoning = {
    controls: [{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] }],
    selectableEfforts: ['minimal', 'low', 'medium', 'high']
  }

  const gpt5 = (): Model => ({
    ...createModel([MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING]),
    id: 'openai::gpt-5',
    providerId: 'openai',
    apiModelId: 'gpt-5',
    reasoning: GPT5_REASONING
  })

  const openAiProvider = { id: 'openai', defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES } as Provider

  it('drops enabled web search when the effort has no builtin search route', () => {
    expect(
      reconcileWebSearchForModel(gpt5(), { enableWebSearch: true, reasoning_effort: 'minimal' }, openAiProvider)
    ).toEqual({ enableWebSearch: false })
  })

  it('keeps enabled web search for a compatible effort', () => {
    expect(
      reconcileWebSearchForModel(gpt5(), { enableWebSearch: true, reasoning_effort: 'low' }, openAiProvider)
    ).toBeNull()
  })

  it('keeps enabled web search with minimal effort on a non-OpenAI-family provider', () => {
    expect(
      reconcileWebSearchForModel(gpt5(), { enableWebSearch: true, reasoning_effort: 'minimal' }, providerWith([]))
    ).toBeNull()
  })

  it('never conflicts on an undefined effort', () => {
    expect(
      reconcileWebSearchForModel(gpt5(), { enableWebSearch: true, reasoning_effort: undefined }, openAiProvider)
    ).toBeNull()
  })

  it('keeps enabled web search at minimal effort when a client search route serves it', () => {
    // `resolveWebToolRoutes` withdraws only the builtin route for the
    // minimal-effort conflict; a ready client search provider still answers.
    expect(
      reconcileWebSearchForModel(gpt5(), { enableWebSearch: true, reasoning_effort: 'minimal' }, openAiProvider, {
        clientSearchAvailable: true
      })
    ).toBeNull()
  })

  it('drops the pair at minimal effort when the model cannot use client tools', () => {
    const noClientTools: Model = { ...gpt5(), capabilities: [MODEL_CAPABILITY.REASONING] }
    expect(
      reconcileWebSearchForModel(
        noClientTools,
        { enableWebSearch: true, reasoning_effort: 'minimal' },
        openAiProvider,
        {
          clientSearchAvailable: true
        }
      )
    ).toEqual({ enableWebSearch: false })
  })
})

describe('resolveModelSwitchSettings (#23582)', () => {
  const GPT5_REASONING: RuntimeReasoning = {
    controls: [{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] }],
    selectableEfforts: ['minimal', 'low', 'medium', 'high']
  }

  const gpt5 = (): Model => ({
    ...createModel([MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING]),
    id: 'openai::gpt-5',
    providerId: 'openai',
    apiModelId: 'gpt-5',
    reasoning: GPT5_REASONING
  })

  const openAiProvider = { id: 'openai', defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES } as Provider

  it('reconciles a restored incompatible pair without overwriting it (search off, effort kept)', () => {
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false },
      remembered: { enableWebSearch: true, reasoning_effort: 'minimal' }
    })

    expect(patch?.enableWebSearch).toBe(false)
    expect(patch?.reasoning_effort).toBe('minimal')
  })

  it('restores a compatible remembered pair as saved', () => {
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false, reasoning_effort: 'default' },
      remembered: { enableWebSearch: true, reasoning_effort: 'low' }
    })

    expect(patch?.enableWebSearch).toBe(true)
    expect(patch?.reasoning_effort).toBe('low')
  })

  it('falls back to search off and the model default effort with no memory', () => {
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: true, reasoning_effort: 'minimal' },
      remembered: undefined
    })

    expect(patch?.enableWebSearch).toBe(false)
    expect(patch?.reasoning_effort).toBe('default')
  })

  it('evaluates the pair against the reconciled effort, not the stale restored one', () => {
    // 'minimal' is outside the next model's vocabulary, so reconciliation maps
    // it to a supported tier first; the search flag then survives.
    const patch = resolveModelSwitchSettings({
      next: { ...gpt5(), reasoning: EFFORT_MAX },
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false },
      remembered: { enableWebSearch: true, reasoning_effort: 'minimal' }
    })

    expect(patch?.reasoning_effort).not.toBe('minimal')
    expect(patch?.enableWebSearch).toBe(true)
  })

  it('preserves remembered search at minimal effort when a client route serves it', () => {
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false },
      remembered: { enableWebSearch: true, reasoning_effort: 'minimal' },
      clientSearchAvailable: true
    })

    expect(patch?.enableWebSearch).toBe(true)
    expect(patch?.reasoning_effort).toBe('minimal')
  })

  it('reconciles the search pair against the extraSettings effort that wins the final spread', () => {
    // The composer bridges a pending effort mutation (set on the previous
    // model, not yet settled) through extraSettings; it overrides the restored
    // remembered effort in the final spread. The pair must be reconciled
    // against that winning effort, not the remembered one.
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false },
      remembered: { enableWebSearch: true, reasoning_effort: 'low' },
      extraSettings: { reasoning_effort: 'minimal' }
    })

    expect(patch?.reasoning_effort).toBe('minimal')
    expect(patch?.enableWebSearch).toBe(false)
  })

  it('keeps restored search when extraSettings wins with a compatible effort', () => {
    const patch = resolveModelSwitchSettings({
      next: gpt5(),
      nextProvider: openAiProvider,
      currentModelId: 'openai::gpt-4o',
      currentSettings: { enableWebSearch: false },
      remembered: { enableWebSearch: true, reasoning_effort: 'minimal' },
      extraSettings: { reasoning_effort: 'low' }
    })

    expect(patch?.reasoning_effort).toBe('low')
    expect(patch?.enableWebSearch).toBe(true)
  })

  it('returns undefined for the same model with nothing to restore or reconcile', () => {
    expect(
      resolveModelSwitchSettings({
        next: gpt5(),
        nextProvider: openAiProvider,
        currentModelId: 'openai::gpt-5',
        currentSettings: { enableWebSearch: true, reasoning_effort: 'low' },
        remembered: { enableWebSearch: false, reasoning_effort: 'minimal' }
      })
    ).toBeUndefined()
  })
})
