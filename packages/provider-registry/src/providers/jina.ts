import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'jina',
  name: 'Jina',
  baseUrl: 'https://api.jina.ai',
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
