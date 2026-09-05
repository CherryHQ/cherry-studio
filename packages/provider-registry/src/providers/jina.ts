import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'jina',
  name: 'Jina',
  availableInEditions: ['global'],
  baseUrl: 'https://api.jina.ai',
  additionalEndpointConfigs: {
    'jina-rerank': { adapterFamily: 'jina-rerank' },
    'openai-embeddings': { adapterFamily: 'openai-compatible' }
  },
  website: {
    apiKey: 'https://jina.ai/',
    docs: 'https://api.jina.ai/scalar',
    models: 'https://jina.ai',
    official: 'https://jina.ai'
  },
  overrides: [
    { modelId: 'jina-code-embeddings-0-5b', apiModelId: 'jina-code-embeddings-0.5b' },
    { modelId: 'jina-code-embeddings-1-5b', apiModelId: 'jina-code-embeddings-1.5b' }
  ]
})
