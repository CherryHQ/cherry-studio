import { defineProvider } from './types'

/**
 * Login-based provider that drives the SuperGrok subscription via xAI OAuth
 * (`authMethods: ['oauth']`) through the Grok CLI chat proxy; model list served
 * from this registry (`modelListSource: 'registry'`). The proxy serves
 * CLI-exclusive models, so both are named standalones rather than base-catalog
 * rows. OAuth runtime lives in `src/main/services/oauth/`.
 */
export default defineProvider({
  id: 'grok-cli',
  name: 'Grok CLI',
  defaultChatEndpoint: 'openai-responses',
  modelListSource: 'registry',
  authMethods: ['oauth'],
  endpointConfigs: {
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://cli-chat-proxy.grok.com/v1' }
  },
  metadata: {
    website: {
      official: 'https://x.ai',
      docs: 'https://docs.x.ai'
    }
  },
  overrides: [
    {
      modelId: 'grok-build',
      name: 'Grok Build',
      description:
        "Grok Build is xAI's agentic coding model, available through the SuperGrok subscription via the Grok CLI proxy.",
      family: 'grok',
      ownedBy: 'xai',
      capabilities: { force: ['function-call', 'reasoning', 'image-recognition'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 512000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1 },
        output: { currency: 'USD', perMillionTokens: 2 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'grok-composer-2.5-fast',
      name: 'Composer 2.5 Fast',
      description:
        "Composer 2.5 Fast is xAI's fast coding model, available through the SuperGrok subscription via the Grok CLI proxy.",
      family: 'grok',
      ownedBy: 'xai',
      capabilities: { force: ['function-call', 'image-recognition'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 200000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 3 },
        output: { currency: 'USD', perMillionTokens: 15 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 }
      }
    }
  ]
})
