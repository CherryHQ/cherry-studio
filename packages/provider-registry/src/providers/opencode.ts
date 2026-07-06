import { defineProvider } from './types'

export default defineProvider({
  id: 'opencode',
  name: 'OpenCode Go',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/go/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://opencode.ai/auth',
      docs: 'https://opencode.ai/docs/go',
      models: 'https://opencode.ai/docs/go',
      official: 'https://opencode.ai'
    }
  }
})
