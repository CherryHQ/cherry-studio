import { defineProvider } from './types'
import { openaiResponsesSummaryWire } from './wires'

const webSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

export default defineProvider({
  id: 'openai',
  name: 'OpenAI',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.openai.com',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  serverTools: [{ id: 'web-search', modelScope: 'model-dependent', modelIdPrefixes: webSearchModels }],
  metadata: {
    website: {
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models',
      official: 'https://openai.com/'
    }
  }
})
