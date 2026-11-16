import { defineProvider } from './types'

export default defineProvider({
  id: 'rapid-mlx',
  name: 'Rapid-MLX',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  defaultChatEndpoint: 'openai-chat-completions',
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
      docs: 'https://github.com/raullenchai/Rapid-MLX',
      official: 'https://rapidmlx.com'
    }
  }
})
