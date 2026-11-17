import { defineProvider } from './types'

// Models, limits and prices are not declared here: the generator (`scripts/dothoosh.ts`) and the app's
// live model list (`listModels.ts`) read them from the gateway's own listings.
export default defineProvider({
  id: 'dothoosh',
  name: 'DotHoosh',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  // The gateway rejects Bearer plus x-api-key, so Responses uses the plain `openai` adapter; agent exports
  // (OpenCode, Pi, Hermes) pick their transport from these configs.
  endpointConfigs: {
    'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://gateway.dothoosh.com' },
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://gateway.dothoosh.com' },
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://gateway.dothoosh.com/anthropic' }
  },
  metadata: {
    website: {
      apiKey: 'https://gateway.dothoosh.com/api-keys',
      docs: 'https://gateway.dothoosh.com/docs',
      models: 'https://gateway.dothoosh.com/models',
      official: 'https://gateway.dothoosh.com'
    }
  }
})
