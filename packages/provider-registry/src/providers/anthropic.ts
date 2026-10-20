import { defineProvider } from './types'

const webToolModels = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]

export default defineProvider({
  overrides: [
    {
      modelId: 'claude-3-haiku',
      disabled: true,
      reason: 'Retired on the official API; third-party hosting is independent.'
    },
    {
      modelId: 'claude-opus-4',
      disabled: true,
      reason: 'Retired on the official API; third-party hosting is independent.'
    },
    {
      modelId: 'claude-opus-4-1',
      disabled: true,
      reason: 'Retired on the official API; third-party hosting is independent.'
    },
    {
      modelId: 'claude-sonnet-4',
      disabled: true,
      reason: 'Retired on the official API; third-party hosting is independent.'
    }
  ],
  id: 'anthropic',
  name: 'Anthropic',
  availableInEditions: ['global'],
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
      billing: 'https://platform.claude.com/settings/billing',
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models',
      official: 'https://anthropic.com/'
    }
  }
})
