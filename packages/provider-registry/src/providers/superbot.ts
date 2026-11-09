import { defineProvider } from './types'

/**
 * superbot serves an OpenAI-compatible API at one base URL with one caller key (`sbc_...`).
 * `GET /v1/models` lists the models a key can call, so the list is filled at runtime.
 */
export default defineProvider({
  id: 'superbot',
  name: 'superbot',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.superbot.gg/v1',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://superbot.gg/api?utm_source=cherry-studio&utm_medium=registry&utm_campaign=default-slots',
      docs: 'https://superbot.gg/api?utm_source=cherry-studio&utm_medium=registry&utm_campaign=default-slots',
      official: 'https://superbot.gg/?utm_source=cherry-studio&utm_medium=registry&utm_campaign=default-slots'
    }
  }
})
