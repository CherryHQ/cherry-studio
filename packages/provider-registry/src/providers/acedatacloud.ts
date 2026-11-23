import { defineProvider, openaiCompatible } from './types'

const provider = openaiCompatible({
  id: 'acedatacloud',
  name: 'Ace Data Cloud',
  availableInEditions: ['global'],
  baseUrl: 'https://api.acedata.cloud/v1',
  anthropic: 'https://api.acedata.cloud',
  website: {
    apiKey:
      'https://platform.acedata.cloud/console/applications?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_api_key',
    docs: 'https://platform.acedata.cloud/documents/openai-chat-completions?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_docs',
    models:
      'https://platform.acedata.cloud/models?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_models',
    official:
      'https://platform.acedata.cloud?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_website'
  }
})

export default defineProvider({
  ...provider,
  endpointConfigs: {
    ...provider.endpointConfigs,
    'openai-responses': { adapterFamily: 'open-responses', baseUrl: 'https://api.acedata.cloud/v1' }
  },
  modelResolution: {
    source: 'provider',
    defaults: {
      capabilities: [],
      inputModalities: ['text'],
      outputModalities: ['text'],
      endpointTypes: ['openai-chat-completions'],
      parameterSupport: { tools: { supported: null } },
      supportsStreaming: true
    }
  }
})
