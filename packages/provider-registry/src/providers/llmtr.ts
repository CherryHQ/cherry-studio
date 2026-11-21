import { defineProvider } from './types'

/**
 * LLMTR is an OpenAI-compatible gateway. `/v1/models` fills the list at runtime;
 * model IDs are vendor/model paths such as minimax/minimax-m3.1-flash.
 */
export default defineProvider({
  id: 'llmtr',
  name: 'LLMTR',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://llmtr.com/v1',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://llmtr.com/dashboard/keys',
      docs: 'https://llmtr.com',
      official: 'https://llmtr.com/'
    }
  }
})
