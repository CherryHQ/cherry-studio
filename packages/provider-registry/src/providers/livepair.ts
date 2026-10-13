import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

// `/v1/agent` speaks chat-completions + the OpenAI Images shape on one base; `reasoning_effort`
// forwards low/medium/high upstream, and per-model vocabularies come from the models.dev rows.
export default defineProvider({
  id: 'livepair',
  name: 'LivePair',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://livepairai.com/v1/agent',
      modelsApiUrls: {
        default: 'https://livepairai.com/v1/agent/models'
      },
      reasoningFormat: {
        type: 'openai-chat',
        wire: modeWire('reasoning_effort', { effort: EFFORT })
      }
    },
    'openai-image-generation': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://livepairai.com/v1/agent'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://livepairai.com/settings',
      docs: 'https://livepairai.com/docs/openai-compatible',
      models: 'https://livepairai.com/v1/agent/models',
      official: 'https://livepairai.com'
    }
  },
  modelsDevProvider: 'livepair'
})
