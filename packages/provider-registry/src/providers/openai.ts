import { defineProvider } from './types'
import { openaiResponsesSummaryWire } from './wires'

const webSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

export default defineProvider({
  id: 'openai',
  name: 'OpenAI',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-text-to-speech': { adapterFamily: 'openai' },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.openai.com',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  overrides: [
    { modelId: 'tts-1', endpointTypes: ['openai-text-to-speech'] },
    { modelId: 'tts-1-hd', endpointTypes: ['openai-text-to-speech'] },
    { modelId: 'gpt-4o-mini-tts', endpointTypes: ['openai-text-to-speech'] }
  ],
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: webSearchModels,
      modelIds: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-1-sol']
    }
  ],
  metadata: {
    website: {
      billing: 'https://platform.openai.com/settings/organization/billing/overview',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models',
      official: 'https://openai.com/'
    }
  }
})
