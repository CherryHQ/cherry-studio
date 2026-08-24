import { defineProvider } from './types'

// Voyage has no `/models` list API, so the served catalog is sourced from this registry
// (`modelListSource: 'registry'`) rather than an upstream fetch. `overrides` enumerate the
// voyage-owned models (see creators/voyage.ts) — capabilities (embedding/rerank) come from
// the base catalog rows at merge time, so rerankers stay out of chat selectors.
export default defineProvider({
  id: 'voyageai',
  name: 'VoyageAI',
  defaultChatEndpoint: 'openai-chat-completions',
  modelListSource: 'registry',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'voyage',
      baseUrl: 'https://api.voyageai.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://dashboard.voyageai.com/organization/api-keys',
      docs: 'https://docs.voyageai.com/docs',
      models: 'https://docs.voyageai.com/docs',
      official: 'https://www.voyageai.com/'
    }
  },
  overrides: [
    // Text embeddings
    { modelId: 'voyage-4-large' },
    { modelId: 'voyage-4' },
    { modelId: 'voyage-4-lite' },
    { modelId: 'voyage-4-nano' },
    { modelId: 'voyage-3-large' },
    { modelId: 'voyage-3-5' },
    { modelId: 'voyage-3-5-lite' },
    { modelId: 'voyage-3' },
    { modelId: 'voyage-3-lite' },
    { modelId: 'voyage-code-3' },
    { modelId: 'voyage-code-2' },
    { modelId: 'voyage-finance-2' },
    { modelId: 'voyage-law-2' },
    { modelId: 'voyage-multilingual-2' },
    { modelId: 'voyage-large-2-instruct' },
    { modelId: 'voyage-large-2' },
    { modelId: 'voyage-2' },
    // Multimodal embeddings
    { modelId: 'voyage-multimodal-3-5' },
    { modelId: 'voyage-multimodal-3' },
    // Rerankers
    { modelId: 'rerank-2-5' },
    { modelId: 'rerank-2-5-lite' },
    { modelId: 'rerank-2' },
    { modelId: 'rerank-2-lite' },
    { modelId: 'rerank-1' },
    { modelId: 'rerank-lite-1' }
  ]
})
