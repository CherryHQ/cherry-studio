import type { ReasoningEffort } from '../schemas/enums'
import type { ReasoningSupport } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const fixedSupport: ReasoningSupport = { controls: [] }

const effortSupport = (values: ReasoningEffort[]): ReasoningSupport => ({
  controls: [{ kind: 'effort', values }]
})

const minimaxM3Wire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }] }
}

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

const chatEffortModels: Array<{ modelId: string; values: ReasoningEffort[] }> = [
  { modelId: 'deepseek-v4-flash', values: ['high', 'max'] },
  { modelId: 'deepseek-v4-pro', values: ['high', 'max'] },
  { modelId: 'glm-5-2', values: ['high', 'max'] },
  { modelId: 'grok-4-5', values: ['low', 'medium', 'high'] },
  { modelId: 'kimi-k3', values: ['max'] }
]

const anthropicFixedModels = ['minimax-m2-5', 'minimax-m2-7']

const qwenBudgetModels = [
  { max: 81_920, modelId: 'qwen3-5-plus' },
  { max: 81_920, modelId: 'qwen3-6-plus' },
  { max: 262_144, modelId: 'qwen3-7-max' },
  { max: 262_144, modelId: 'qwen3-7-plus' }
]

const endpointOverrides: Partial<ProviderModelOverride>[] = [
  ...chatFixedModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const],
    reasoningContracts: {
      'openai-chat-completions': { support: fixedSupport }
    }
  })),
  ...chatEffortModels.map(({ modelId, values }) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const],
    reasoningContracts: {
      'openai-chat-completions': { support: effortSupport(values) }
    }
  })),
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
