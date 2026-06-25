import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'poe',
  name: 'Poe',
  baseUrl: 'https://api.poe.com/v1/',
  website: {
    apiKey: 'https://poe.com/api/keys',
    docs: 'https://creator.poe.com/docs/external-applications/openai-compatible-api',
    models: 'https://poe.com/',
    official: 'https://poe.com/'
  },
  apiFeatures: {
    arrayContent: false,
    developerRole: false
  }
})
