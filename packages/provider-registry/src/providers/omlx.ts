import { defineProvider } from './types'

/**
 * oMLX's Responses endpoint is its native chat surface, so it is the default.
 * `openai-chat-completions` stays declared: the server still serves it and
 * other integrations still speak it.
 */
export default defineProvider({
  id: 'omlx',
  name: 'oMLX',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:8000'
    },
    'openai-responses': {
      adapterFamily: 'open-responses',
      baseUrl: 'http://localhost:8000'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:8000',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/jundot/omlx',
      official: 'https://omlx.ai'
    }
  }
})
