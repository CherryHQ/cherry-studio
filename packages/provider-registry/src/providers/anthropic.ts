import { defineProvider } from './types'

const webToolModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]

export default defineProvider({
  id: 'anthropic',
  name: 'Anthropic',
  supportedEditions: ['global'],
  defaultChatEndpoint: 'anthropic-messages',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com'
    }
  },
  serverTools: [
    { id: 'web-search', modelScope: 'model-dependent', modelIdPrefixes: webToolModels },
    { id: 'url-context', modelScope: 'model-dependent', modelIdPrefixes: webToolModels }
  ],
  metadata: {
    website: {
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models',
      official: 'https://anthropic.com/'
    }
  }
})
