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
    // grok-4-5 / grok-4-3 resolve to base-catalog models; override only the
    // CLI-proxy specifics (30k output cap, flat CLI-side pricing).
    {
      modelId: 'grok-4-5',
      apiModelId: 'grok-4.5',
      limits: { contextWindow: 500000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        output: { currency: 'USD', perMillionTokens: 6 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 }
      }
    },
    {
      modelId: 'grok-4-3',
      apiModelId: 'grok-4.3',
      limits: { contextWindow: 1000000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1.25 },
        output: { currency: 'USD', perMillionTokens: 2.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'grok-4-20-0309-reasoning',
      apiModelId: 'grok-4.20-0309-reasoning',
      name: 'Grok 4.20 Reasoning',
      description:
        "Grok 4.20 Reasoning is xAI's always-on reasoning model with a 2M-token context window, available through the SuperGrok subscription via the Grok CLI proxy.",
      family: 'grok',
      ownedBy: 'xai',
      capabilities: { force: ['function-call', 'reasoning', 'image-recognition'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 2000000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1.25 },
        output: { currency: 'USD', perMillionTokens: 2.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'grok-4-20-0309-non-reasoning',
      apiModelId: 'grok-4.20-0309-non-reasoning',
      name: 'Grok 4.20 Non-Reasoning',
      description:
        "Grok 4.20 Non-Reasoning is xAI's fast non-reasoning model with a 2M-token context window, available through the SuperGrok subscription via the Grok CLI proxy.",
      family: 'grok',
      ownedBy: 'xai',
      capabilities: { force: ['function-call', 'image-recognition'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 2000000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1.25 },
        output: { currency: 'USD', perMillionTokens: 2.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'grok-4-20-multi-agent-0309',
      apiModelId: 'grok-4.20-multi-agent-0309',
      name: 'Grok 4.20 Multi-Agent',
      description:
        'Grok 4.20 Multi-Agent runs multiple agents collaborating in parallel for deep research tasks, available through the SuperGrok subscription via the Grok CLI proxy.',
      family: 'grok',
      ownedBy: 'xai',
      capabilities: { force: ['function-call', 'reasoning', 'image-recognition'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 2000000, maxOutputTokens: 30000 },
      endpointTypes: ['openai-responses'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1.25 },
        output: { currency: 'USD', perMillionTokens: 2.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
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
