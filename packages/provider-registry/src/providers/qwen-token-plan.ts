import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { effortChatWire, highMaxSupport, qwen38ChatWire, qwen38Support, qwenChatWire } from './qwenFamily'
import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

const responsesEffortWire = modeWire(
  'reasoningEffort',
  { off: 'none', auto: EFFORT, effort: EFFORT },
  { autoEffort: 'xhigh' }
)

const anthropicToggleSupport: ReasoningSupport = { controls: [{ kind: 'toggle', default: true }] }

const anthropicWire: ReasoningWireProfile = modeWire('thinking.type', {
  off: 'disabled',
  auto: 'enabled',
  effort: 'enabled'
})

const kimiSupport: ReasoningSupport = {
  controls: [{ kind: 'toggle', default: false }]
}

const kimiChatWire: ReasoningWireProfile = modeWire('enable_thinking', { off: false, auto: true })

const glm53Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['high', 'max'], default: 'high' }],
  defaultEffort: 'high',
  supportedEfforts: ['high', 'max']
}

const glm53ChatWire: ReasoningWireProfile = {
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'reasoning_effort', value: { source: 'effort' } }
    ]
  }
}

// Same Responses `reasoning.effort` ladder as Bailian — seven tiers defaulting to `xhigh`
// (help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses); dashscope's constants are module-local.
const responsesSupport: ReasoningSupport = {
  controls: [
    { kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'xhigh' }
  ],
  defaultEffort: 'xhigh',
  supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
}

/**
 * Token Plan is a separate subscription product on its own Beijing host with dedicated `sk-sp-` keys.
 * All three endpoints are declared so an Agent turn resolves the Anthropic endpoint without a manual
 * edit — `resolveEffectiveEndpoint` accepts the preference only when the model lists the endpoint.
 */
export default defineProvider({
  id: 'qwen-token-plan',
  name: 'Qwen Token Plan',
  availableInEditions: ['global', 'cn'],
  modelListSource: 'registry',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
      reasoningFormat: { type: 'anthropic', wire: anthropicWire }
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  serverTools: [
    // Other documented tools (URL context, image searches, code interpreter) await per-SKU evidence on this host.
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIds: ['qwen3-8-max', 'qwen3-8-flash', 'qwen3-7-max', 'qwen3-7-plus', 'qwen3-6-plus', 'qwen3-6-flash'],
      endpointTypes: ['openai-responses']
    }
  ],
  metadata: {
    website: {
      apiKey: 'https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan',
      docs: 'https://help.aliyun.com/zh/model-studio/token-plan-overview',
      models: 'https://help.aliyun.com/zh/model-studio/token-plan-team-overview',
      official: 'https://www.qianwenai.com/benefits/tokenplan'
    }
  },
  overrides: [
    {
      apiModelId: 'qwen3.8-max',
      modelId: 'qwen3-8-max',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'qwen3.8-flash',
      modelId: 'qwen3-8-flash',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'qwen3.7-max',
      modelId: 'qwen3-7-max',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { wire: qwenChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'qwen3.7-plus',
      modelId: 'qwen3-7-plus',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { wire: qwenChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'qwen3.6-plus',
      modelId: 'qwen3-6-plus',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { wire: qwenChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'qwen3.6-flash',
      modelId: 'qwen3-6-flash',
      endpointTypes: ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { wire: qwenChatWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      apiModelId: 'deepseek-v4.1-flash',
      modelId: 'deepseek-v4-1-flash',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'deepseek-v4-pro',
      modelId: 'deepseek-v4-pro',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    // Dated snapshots ride the same canonical row under a vendor-exclusive name.
    {
      apiModelId: 'deepseek-v4-pro-0813',
      modelId: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro (0813)',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'deepseek-v4-flash-0731',
      modelId: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash (0731)',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'kimi-k2.7-code',
      modelId: 'kimi-k2-7-code',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire }
      }
    },
    {
      apiModelId: 'kimi-k2.6',
      modelId: 'kimi-k2-6',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: kimiSupport, wire: kimiChatWire }
      }
    },
    {
      apiModelId: 'kimi-k2.5',
      modelId: 'kimi-k2-5',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: kimiSupport, wire: kimiChatWire }
      }
    },
    {
      apiModelId: 'glm-5.3',
      modelId: 'glm-5-3',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: glm53Support, wire: glm53ChatWire }
      }
    },
    {
      apiModelId: 'glm-5.2',
      modelId: 'glm-5-2',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'glm-5.1',
      modelId: 'glm-5-1',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'glm-5',
      modelId: 'glm-5',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
      }
    },
    {
      apiModelId: 'MiniMax-M2.5',
      modelId: 'minimax-m2-5',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'anthropic-messages': { support: anthropicToggleSupport, wire: anthropicWire }
      }
    }
  ]
})
