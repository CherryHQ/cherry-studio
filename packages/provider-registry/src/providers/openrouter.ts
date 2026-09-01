import { CURRENCY } from '../schemas/enums'
import { defineProvider } from './types'

export default defineProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  // OpenRouter's usage response carries the actual billed amount, so the cost
  // engine trusts it over locally computed pricing.
  reportsActualCost: true,
  reportedCostCurrency: CURRENCY.USD,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://openrouter.ai/api',
      requestControls: {
        serviceTier: {
          default: 'standard',
          options: ['standard', 'fast', 'flex'],
          wire: {
            delivery: { type: 'request-body', key: 'service_tier' },
            values: { standard: 'default', fast: 'priority', flex: 'flex' }
          }
        }
      }
    },
    'openai-chat-completions': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'reasoning.effort', value: { source: 'literal', value: 'none' } }] },
          auto: { operations: [{ target: 'reasoning.effort', value: { source: 'literal', value: 'medium' } }] },
          effort: { operations: [{ target: 'reasoning.effort', value: { source: 'effort' } }] }
        }
      },
      requestControls: {
        serviceTier: {
          default: 'standard',
          options: ['standard', 'fast', 'flex'],
          wire: {
            delivery: { type: 'provider-option', key: 'service_tier' },
            values: { standard: 'default', fast: 'priority', flex: 'flex' }
          }
        }
      },
      modelsApiUrls: {
        default: 'https://openrouter.ai/api/v1/models',
        embedding: 'https://openrouter.ai/api/v1/embeddings/models',
        image: 'https://openrouter.ai/api/v1/images/models'
      }
    },
    'openai-embeddings': {
      adapterFamily: 'openrouter'
    },
    'openai-image-generation': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/'
    }
  },
  serverTools: [
    { id: 'web-search', modelScope: 'all-chat-models' },
    { id: 'url-context', modelScope: 'all-chat-models' }
  ],
  metadata: {
    website: {
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/models',
      official: 'https://openrouter.ai/'
    }
  },
  modelsDevProvider: 'openrouter',
  standaloneModelIds: ['gpt-5-4-image-2'],
  overrides: [
    // OpenRouter owns this moving router alias; DeepSeek does not publish it as
    // a model. Actual usage cost is authoritative, so omit a static alias price.
    { modelId: 'deepseek-v4-flash-latest', name: 'DeepSeek V4 Flash Latest', pricing: undefined },
    {
      modelId: 'gpt-5-4-image-2',
      name: 'OpenAI: GPT-5.4 Image 2',
      ownedBy: 'openrouter'
    }
  ]
})
