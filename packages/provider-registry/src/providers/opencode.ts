import type { ReasoningEffort } from '../schemas/enums'
import type { ReasoningSupport } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'
import { modeWire, openaiResponsesSummaryWire } from './wires'

const fixedSupport: ReasoningSupport = { controls: [] }

const effortSupport = (values: ReasoningEffort[], defaultEffort?: ReasoningEffort): ReasoningSupport => ({
  controls: [{ kind: 'effort', values, ...(defaultEffort ? { default: defaultEffort } : {}) }],
  ...(defaultEffort ? { defaultEffort } : {})
})

const minimaxM3Wire: ReasoningWireProfile = modeWire('thinking.type', { off: 'disabled', auto: 'adaptive' })

const qwenBudgetWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
      { target: 'thinking.budgetTokens', value: { source: 'budget' } }
    ],
    budget: { min: 1024, clampToMaxTokens: true, missing: { type: 'omit-mode' } }
  }
}

const chatFixedModels = [
  'glm-5',
  'glm-5-1',
  'kimi-k2-5',
  'kimi-k2-6',
  'kimi-k2-7-code',
  'mimo-v2-5',
  'mimo-v2-5-pro',
  'mimo-v2-omni',
  'mimo-v2-pro'
]

const chatEffortModels: Array<{
  modelId: string
  values: ReasoningEffort[]
  defaultEffort?: ReasoningEffort
  pricing?: ProviderModelOverride['pricing']
}> = [
  { modelId: 'deepseek-v4-flash', values: ['high', 'max'] },
  { modelId: 'deepseek-v4-flash-vision-exp', values: ['high', 'max'] },
  { modelId: 'deepseek-v4-pro', values: ['high', 'max'] },
  { modelId: 'glm-5-2', values: ['high', 'max'] },
  { modelId: 'glm-5-3', values: ['low', 'high', 'max'], defaultEffort: 'max' },
  {
    modelId: 'glm-5-3-flash',
    values: ['low', 'high', 'max'],
    defaultEffort: 'max',
    pricing: {
      cacheRead: { currency: 'USD', perMillionTokens: 0.03 },
      input: { currency: 'USD', perMillionTokens: 0.15 },
      output: { currency: 'USD', perMillionTokens: 0.5 }
    }
  },
  { modelId: 'hy3', values: ['none', 'low', 'high'] },
  { modelId: 'kimi-k3', values: ['max'] },
  // Stealth model, no creator entry: models.dev routes it through `@ai-sdk/openai-compatible`
  // and prints an effort ladder, so pin chat/completions rather than let it fall back unpinned.
  { modelId: 'ox-alpha', values: ['low', 'high', 'max'] }
]

const anthropicFixedModels = ['minimax-m2-5', 'minimax-m2-7']

const qwenBudgetModels = [
  { max: 81_920, modelId: 'qwen3-5-plus' },
  { max: 81_920, modelId: 'qwen3-6-plus' },
  { max: 262_144, modelId: 'qwen3-7-max' },
  { max: 262_144, modelId: 'qwen3-7-plus' },
  { max: 262_144, modelId: 'qwen3-8-max' }
]

const endpointOverrides: Partial<ProviderModelOverride>[] = [
  ...chatFixedModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const],
    reasoningContracts: {
      'openai-chat-completions': { support: fixedSupport }
    }
  })),
  ...chatEffortModels.map(({ modelId, values, defaultEffort, pricing }) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const],
    ...(pricing ? { pricing } : {}),
    reasoningContracts: {
      'openai-chat-completions': { support: effortSupport(values, defaultEffort) }
    }
  })),
  { modelId: 'longcat-2-0', endpointTypes: ['openai-chat-completions'] },
  // models.dev routes Zen Go's Grok 4.5 through `@ai-sdk/openai` (Responses); the Go endpoint table
  // still prints chat/completions, so Chat stays selectable behind the Responses default (#17860).
  {
    modelId: 'grok-4-5',
    endpointTypes: ['openai-responses' as const, 'openai-chat-completions' as const],
    reasoningContracts: {
      'openai-responses': { support: effortSupport(['low', 'medium', 'high']) },
      'openai-chat-completions': { support: effortSupport(['low', 'medium', 'high']) }
    }
  },
  {
    modelId: 'grok-4-6',
    endpointTypes: ['openai-responses'],
    reasoningContracts: {
      'openai-responses': { support: effortSupport(['low', 'medium', 'high', 'xhigh']) }
    }
  },
  {
    modelId: 'gpt-5-6-luna',
    endpointTypes: ['openai-responses' as const],
    reasoningContracts: {
      'openai-responses': { support: effortSupport(['none', 'low', 'medium', 'high', 'xhigh', 'max']) }
    }
  },
  {
    modelId: 'muse-spark-1-2-contributor',
    endpointTypes: ['openai-responses' as const],
    reasoningContracts: {
      'openai-responses': { support: effortSupport(['minimal', 'low', 'medium', 'high', 'xhigh']) }
    }
  },
  ...anthropicFixedModels.map((modelId) => ({
    modelId,
    endpointTypes: ['anthropic-messages' as const],
    reasoningContracts: {
      'anthropic-messages': { support: fixedSupport }
    }
  })),
  {
    modelId: 'minimax-m3',
    endpointTypes: ['anthropic-messages'],
    reasoningContracts: {
      'anthropic-messages': {
        support: { controls: [{ kind: 'toggle', default: true }] },
        wire: minimaxM3Wire
      }
    }
  },
  ...qwenBudgetModels.map(({ max, modelId }) => ({
    modelId,
    endpointTypes: ['anthropic-messages' as const],
    reasoningContracts: {
      'anthropic-messages': {
        support: { controls: [{ kind: 'budget' as const, min: 1, max }, { kind: 'toggle' as const }] },
        wire: qwenBudgetWire
      }
    }
  }))
]

export default defineProvider({
  id: 'opencode',
  name: 'OpenCode Go',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoningFormat: { type: 'anthropic' }
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      modelsApiUrls: { default: 'https://opencode.ai/zen/go/v1/models' },
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://opencode.ai/auth',
      docs: 'https://opencode.ai/docs/go/',
      models: 'https://opencode.ai/zen/go/v1/models',
      official: 'https://opencode.ai'
    }
  },
  modelsDevProvider: 'opencode-go',
  overrides: endpointOverrides
})
