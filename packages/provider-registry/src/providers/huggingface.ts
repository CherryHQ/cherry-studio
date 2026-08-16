import { defineProvider } from './types'

export default defineProvider({
  id: 'huggingface',
  name: 'Hugging Face',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    // The router serves every model it lists over Anthropic Messages too, which is how HF documents
    // running Claude Code on it (huggingface.co/docs/inference-providers/en/integrations/claude-code).
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://router.huggingface.co/v1'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://router.huggingface.co/v1'
    },
    // Trails the two general surfaces: the router's Responses API is still beta, and the adapter that
    // reaches it drops assistant tool calls and every tool result, which breaks Agent tool loops.
    'openai-responses': {
      adapterFamily: 'huggingface',
      baseUrl: 'https://router.huggingface.co/v1/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://huggingface.co/settings/tokens',
      docs: 'https://huggingface.co/docs',
      models: 'https://huggingface.co/models',
      official: 'https://huggingface.co/'
    }
  },
  modelsDevProvider: 'huggingface'
})
