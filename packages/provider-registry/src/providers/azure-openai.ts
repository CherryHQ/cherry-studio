import { defineProvider } from './types'
import { openaiResponsesSummaryWire } from './wires'

const claudeWebToolModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]
const openAIWebSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

export default defineProvider({
  id: 'azure-openai',
  name: 'Azure OpenAI',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'azure'
    },
    'openai-responses': {
      adapterFamily: 'azure-responses',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...openAIWebSearchModels]
    },
    { id: 'url-context', modelScope: 'model-dependent', modelIdPrefixes: claudeWebToolModels }
  ],
  metadata: {
    website: {
      apiKey: 'https://portal.azure.com/',
      docs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
      models: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models',
      official: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service'
    }
  }
})
