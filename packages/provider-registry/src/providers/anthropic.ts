import { defineProvider } from './types'

export default defineProvider({
  id: 'anthropic',
  name: 'Anthropic',
  defaultChatEndpoint: 'anthropic-messages',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models',
      official: 'https://anthropic.com/'
    }
  }
})
