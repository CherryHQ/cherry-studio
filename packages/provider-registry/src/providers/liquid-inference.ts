import { defineProvider } from './types'

/**
 * The exchange serves about 980 model ids and the list changes with the offers, so `/v1/models`
 * (public, no key needed) fills the list at runtime. `liquid.auto` lets the exchange choose the model.
 */
export default defineProvider({
  id: 'liquid-inference',
  name: 'Liquid Inference',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://router.inference.ai.exchange/v1',
      modelsApiUrls: {
        default: 'https://router.inference.ai.exchange/v1/models'
      }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://inference.ai.exchange/docs/keys?utm_source=cherry-studio&utm_medium=registry',
      docs: 'https://inference.ai.exchange/docs/connect-cherry-studio?utm_source=cherry-studio&utm_medium=registry',
      models: 'https://router.inference.ai.exchange/v1/models',
      official: 'https://liquidinference.ai?utm_source=cherry-studio&utm_medium=registry'
    }
  }
})
