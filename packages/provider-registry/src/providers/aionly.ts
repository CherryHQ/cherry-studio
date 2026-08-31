import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'aionly',
  name: 'AIOnly',
  baseUrl: 'https://api.aiionly.com',
  anthropic: 'https://api.aiionly.com',
  additionalEndpointConfigs: {
    'jina-rerank': { adapterFamily: 'openai-compatible' },
    'openai-embeddings': { adapterFamily: 'openai-compatible' },
    'openai-image-generation': { adapterFamily: 'openai-compatible' }
  },
  website: {
    apiKey: 'https://maas.aiionly.com/keyApi',
    docs: 'https://maas.aiionly.com/document',
    models: 'https://maas.aiionly.com',
    official: 'https://www.aiionly.com'
  }
})
