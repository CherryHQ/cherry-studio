import { defineProvider } from './types'

/**
 * AI Stupid Level Smart Router: OpenAI-compatible, with the user's own provider keys. Model ids are
 * routing modes (auto-coding, auto-reasoning, auto-tooling, auto-value, ...) that pick a model per
 * request from continuously re-run benchmarks, or real model ids that pin one model. The list
 * comes from `/v1/models` at runtime.
 */
export default defineProvider({
  id: 'aistupidlevel',
  name: 'AI Stupid Level',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://aistupidlevel.info/v1',
      reasoningFormat: { type: 'openai-chat' },
      modelsApiUrls: { default: 'https://aistupidlevel.info/v1/models' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://aistupidlevel.info/router/keys',
      docs: 'https://aistupidlevel.info/router/docs',
      models: 'https://aistupidlevel.info/router/docs#strategies',
      official: 'https://aistupidlevel.info'
    }
  }
})
