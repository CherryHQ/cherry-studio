import { defineProvider } from './types'

export default defineProvider({
  id: 'azure-openai',
  name: 'Azure OpenAI',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'azure'
    },
    'openai-responses': {
      adapterFamily: 'azure-responses'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://portal.azure.com/',
      docs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
      models: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models',
      official: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service'
    }
  }
})
