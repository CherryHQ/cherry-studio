import { defineProvider } from './types'

/**
 * LiteLLM Proxy model names are aliases from the proxy config, so `/v1/models` fills the list at runtime.
 * Only chat completions is declared: backends behind the proxy can reject a system message that is not
 * first, and this path folds those messages (see inlineSystemMessages.ts).
 */
export default defineProvider({
  id: 'litellm',
  name: 'LiteLLM',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:4000',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://docs.litellm.ai/docs/proxy/virtual_keys',
      docs: 'https://docs.litellm.ai/docs/proxy/quick_start',
      official: 'https://www.litellm.ai/'
    }
  }
})
