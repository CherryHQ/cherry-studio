import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const toggleSupport: ReasoningSupport = {
  controls: [{ kind: 'toggle', default: true }]
}

const chatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
}

const responsesWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }] },
  auto: { operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'medium' } }] }
}

// MiMo's Anthropic-compatible API enables thinking by default. Omitting the
// auto mode preserves that default without making the Anthropic SDK inject a
// Claude-style budget_tokens field that MiMo does not document.
const anthropicWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] }
}

export default defineProvider({
  id: 'mimo',
  name: 'Xiaomi MiMo',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.xiaomimimo.com/anthropic',
      reasoningFormat: { type: 'anthropic' }
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.xiaomimimo.com',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.xiaomimimo.com',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://platform.xiaomimimo.com/',
      docs: 'https://mimo.mi.com/docs/zh-CN',
      models: 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/model',
      official: 'https://mimo.mi.com/'
    }
  },
  overrides: [
    ...['mimo-v2-5', 'mimo-v2-5-pro'].map((modelId) => ({
      modelId,
      reasoningContracts: {
        'anthropic-messages': { support: toggleSupport, wire: anthropicWire },
        'openai-chat-completions': { support: toggleSupport, wire: chatWire },
        'openai-responses': { support: toggleSupport, wire: responsesWire }
      }
    })),
    {
      modelId: 'mimo-v2-5-pro-ultraspeed',
      reasoningContracts: {
        'anthropic-messages': { support: { controls: [] }, wire: { disabled: true } },
        'openai-chat-completions': { support: { controls: [] }, wire: { disabled: true } },
        'openai-responses': { support: { controls: [] }, wire: { disabled: true } }
      }
    }
  ]
})
