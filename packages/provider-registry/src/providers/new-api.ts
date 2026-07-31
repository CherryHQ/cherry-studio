import { defineProvider } from './types'
import { modeWire } from './wires'

const deepSeekThinkingWire = modeWire('extra_body.thinking.type', {
  off: 'disabled',
  auto: 'enabled',
  effort: 'enabled'
})

const deepSeekModels = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3-1', 'deepseek-v3-2']

export default defineProvider({
  id: 'new-api',
  name: 'New API',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      baseUrl: 'http://localhost:3000'
    },
    'google-generate-content': {
      baseUrl: 'http://localhost:3000'
    }
  },
  serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }],
  metadata: {
    website: {
      docs: 'https://docs.newapi.pro',
      official: 'https://docs.newapi.pro/'
    }
  },
  overrides: deepSeekModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }))
})
