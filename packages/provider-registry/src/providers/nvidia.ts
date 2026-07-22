import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'

const toggleSupport: ReasoningSupport = { controls: [{ kind: 'toggle' }] }
const enabledByDefaultToggleSupport: ReasoningSupport = { controls: [{ kind: 'toggle', default: true }] }

const deepSeekSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }],
  defaultEffort: 'high'
}

const gptOssSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
  defaultEffort: 'medium'
}

const mistralSmall4Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'high'], default: 'high' }],
  defaultEffort: 'high'
}

const nemotronSuperSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'low', 'high'], default: 'high' }],
  defaultEffort: 'high'
}

const nemotronUltraSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'medium', 'high'], default: 'high' }],
  defaultEffort: 'high'
}

const nemotronOmniSupport: ReasoningSupport = {
  controls: [{ kind: 'budget', min: 0, max: 32_768, default: 16_384 }],
  thinkingTokenLimits: { min: 0, max: 32_768, default: 16_384 }
}

const seedOssSupport: ReasoningSupport = {
  controls: [
    { kind: 'toggle', default: true },
    { kind: 'budget', min: 0, max: 16_384 }
  ],
  thinkingTokenLimits: { min: 0, max: 16_384 }
}

const enableThinkingWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: false } }]
  },
  auto: {
    operations: [{ target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: true } }]
  }
}

const thinkingWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'chat_template_kwargs.thinking', value: { source: 'literal', value: false } }]
  },
  auto: {
    operations: [{ target: 'chat_template_kwargs.thinking', value: { source: 'literal', value: true } }]
  }
}

const minimaxM3Wire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'chat_template_kwargs.thinking_mode', value: { source: 'literal', value: 'disabled' } }]
  },
  auto: {
    operations: [{ target: 'chat_template_kwargs.thinking_mode', value: { source: 'literal', value: 'adaptive' } }]
  }
}

const effortWire: ReasoningWireProfile = {
  effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] }
}

const effortWithOffWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'reasoning_effort', value: { source: 'literal', value: 'none' } }] },
  effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] }
}

const nemotronOmniWire: ReasoningWireProfile = {
  effort: {
    operations: [{ target: 'reasoning_budget', value: { source: 'budget' } }],
    budget: { min: 1, clampToMaxTokens: true, missing: { type: 'omit-mode' } }
  }
}

const seedOssWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking_budget', value: { source: 'literal', value: 0 } }] },
  auto: { operations: [{ target: 'thinking_budget', value: { source: 'literal', value: -1 } }] },
  effort: {
    operations: [{ target: 'thinking_budget', value: { source: 'budget' } }],
    budget: { min: 1, clampToMaxTokens: true, missing: { type: 'omit-mode' } }
  }
}

const chatContract = (support: ReasoningSupport, wire: ReasoningWireProfile) => ({
  'openai-chat-completions': { support, wire }
})

export default openaiCompatible({
  id: 'nvidia',
  name: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com',
  // NIM reasoning controls are model-specific. Unknown/new models stay
  // fail-closed until an exact contract is audited below.
  reasoningFormat: { type: 'openai-chat', wire: { disabled: true } },
  website: {
    apiKey: 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
    docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    models: 'https://build.nvidia.com/nim',
    official: 'https://build.nvidia.com/explore/discover'
  },
  modelsDevProvider: 'nvidia',
  overrides: [
    ...['qwen3-5-122b-a10b', 'qwen3-5-397b-a17b'].map((modelId) => ({
      modelId,
      reasoningContracts: chatContract(toggleSupport, enableThinkingWire)
    })),
    {
      modelId: 'kimi-k2-6',
      reasoningContracts: chatContract(toggleSupport, thinkingWire)
    },
    {
      modelId: 'gemma-4-31b-it',
      reasoningContracts: chatContract(enabledByDefaultToggleSupport, enableThinkingWire)
    },
    {
      modelId: 'minimax-m3',
      reasoningContracts: chatContract(toggleSupport, minimaxM3Wire)
    },
    ...['deepseek-v4-flash', 'deepseek-v4-pro'].map((modelId) => ({
      modelId,
      reasoningContracts: chatContract(deepSeekSupport, effortWithOffWire)
    })),
    ...['gpt-oss-20b', 'gpt-oss-120b'].map((modelId) => ({
      modelId,
      reasoningContracts: chatContract(gptOssSupport, effortWire)
    })),
    {
      modelId: 'mistral-small-4-119b',
      reasoningContracts: chatContract(mistralSmall4Support, effortWithOffWire)
    },
    {
      modelId: 'nemotron-3-super-120b-a12b',
      reasoningContracts: chatContract(nemotronSuperSupport, effortWithOffWire)
    },
    {
      modelId: 'nemotron-3-ultra-550b-a55b',
      reasoningContracts: chatContract(nemotronUltraSupport, effortWithOffWire)
    },
    {
      modelId: 'nemotron-3-nano-omni-30b-a3b',
      reasoningContracts: chatContract(nemotronOmniSupport, nemotronOmniWire)
    },
    {
      modelId: 'seed-oss-36b-instruct',
      reasoningContracts: chatContract(seedOssSupport, seedOssWire)
    }
  ]
})
