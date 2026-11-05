import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'ionet',
  name: 'IO Intelligence',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.intelligence.io.solutions/api/v1',
  website: {
    apiKey: 'https://ai.io.net/ai/api-keys',
    docs: 'https://io.net/docs/guides/intelligence/api-keys-and-secrets',
    models: 'https://io.net/intelligence',
    official: 'https://io.net/'
  },
  modelsDevProvider: 'io-net'
})
