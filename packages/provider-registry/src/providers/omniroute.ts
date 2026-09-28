import { defineProvider } from './types'

export default defineProvider({
  id: 'omniroute',
  name: 'OmniRoute',
  availableInEditions: ['global', 'cn'],
  // Local server: run `omniroute serve`, then enter the generated API key in provider settings.
  // Get a key: POST http://localhost:20128/api/auth/login (password: CHANGEME), then POST /api/keys.
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:20128/v1',
      // OmniRoute exposes its full catalog (1200+ models) at /v1/models
      modelsApiUrls: { default: 'http://localhost:20128/v1/models' }
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/diegosouzapw/OmniRoute',
      models: 'https://github.com/diegosouzapw/OmniRoute#-providers',
      official: 'https://github.com/diegosouzapw/OmniRoute'
    }
  },
  // `auto` is OmniRoute's zero-config virtual router: pick it and OmniRoute
  // selects the best available free-tier provider for every request.
  // Other routing variants (auto/coding, auto/fast …) appear after the model
  // list is fetched from localhost:20128/v1/models.
  standaloneModelIds: ['auto'],
  overrides: [{ modelId: 'auto', name: 'OmniRoute Auto' }]
})
