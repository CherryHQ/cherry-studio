import { defineProvider } from './types'

// Voyage has no `/models` list API, so the served catalog is sourced from this registry
// (`modelListSource: 'registry'`) rather than an upstream fetch. `overrides` enumerate the
// voyage-owned models (see creators/voyage.ts) — capabilities (embedding/rerank) come from
// the base catalog rows at merge time, so rerankers stay out of chat selectors.
export default defineProvider({
  id: 'voyageai',
  name: 'VoyageAI',
  availableInEditions: ['global'],
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
    { apiModelId: 'voyage-4-large' },
    { apiModelId: 'voyage-4' },
    { apiModelId: 'voyage-4-lite' },
    { apiModelId: 'voyage-4-nano' },
    { apiModelId: 'voyage-3-large' },
    { apiModelId: 'voyage-3-5' },
    { apiModelId: 'voyage-3-5-lite' },
    { apiModelId: 'voyage-3' },
    { apiModelId: 'voyage-3-lite' },
    { apiModelId: 'voyage-code-3' },
    { apiModelId: 'voyage-code-2' },
    { apiModelId: 'voyage-finance-2' },
    { apiModelId: 'voyage-law-2' },
    { apiModelId: 'voyage-multilingual-2' },
    { apiModelId: 'voyage-large-2-instruct' },
    { apiModelId: 'voyage-large-2' },
    { apiModelId: 'voyage-2' },
    // Multimodal embeddings
    { apiModelId: 'voyage-multimodal-3-5' },
    { apiModelId: 'voyage-multimodal-3' },
    // Rerankers
    { apiModelId: 'rerank-2-5' },
    { apiModelId: 'rerank-2-5-lite' },
    { apiModelId: 'rerank-2' },
    { apiModelId: 'rerank-2-lite' },
    { apiModelId: 'rerank-1' },
    { apiModelId: 'rerank-lite-1' }
  ]
})
