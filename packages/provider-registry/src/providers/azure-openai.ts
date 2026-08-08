import { defineProvider } from './types'

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
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'azure'
    },
    'openai-responses': {
      adapterFamily: 'azure'
    },
    // No baseUrl: every Azure deployment has its own host, so it comes from the row.
    // Azure AI Foundry serves Anthropic's models over their native protocol; saying so here (rather
    // than a `startsWith('claude')` inside the config builder) is what lets the reasoning projection
    // resolve the same endpoint the request uses — otherwise Claude-on-Azure gets the openai-chat wire.
    'anthropic-messages': {
      adapterFamily: 'azure',
      serves: { pattern: '^claude' }
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
