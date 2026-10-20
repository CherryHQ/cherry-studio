import { defineProvider } from './types'

/**
 * AiOnly is a New API–style multi-protocol relay (models expose
 * `supported_endpoint_types` such as anthropic / openai / gemini). Route every
 * protocol through the `newapi` adapter so each endpoint hits the correct wire
 * format instead of falling back to plain `openai-compatible`.
 */
export default defineProvider({
  id: 'aionly',
  name: 'AIOnly',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi'
    },
    'google-generate-content': {
      adapterFamily: 'newapi'
    },
    'openai-responses': {
      adapterFamily: 'newapi'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'https://api.aiionly.com',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://maas.aiionly.com/keyApi',
      docs: 'https://maas.aiionly.com/document',
      models: 'https://maas.aiionly.com',
      official: 'https://www.aiionly.com'
    }
  }
})
