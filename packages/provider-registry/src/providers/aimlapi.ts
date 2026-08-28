import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'aimlapi',
  name: 'AI/ML API',
  baseUrl: 'https://api.aimlapi.com/v1',
  anthropic: 'https://api.aimlapi.com',
  website: {
    apiKey: 'https://aimlapi.com/app/keys',
    docs: 'https://docs.aimlapi.com',
    models: 'https://aimlapi.com/models',
    official: 'https://aimlapi.com'
  }
})
