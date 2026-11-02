import { defineProvider } from './types'

/**
 * llamay serves the OpenAI API at /v1 and Anthropic Messages at /v1/messages from one local port, with no key
 * unless the server is started with `-api-key`. `/v1/models` lists the models on disk.
 */
export default defineProvider({
  id: 'llamay',
  name: 'llamay',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:11435'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:11435',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      docs: 'https://llamay.com/docs/',
      models: 'https://huggingface.co/models?library=gguf',
      official: 'https://llamay.com/'
    }
  }
})
