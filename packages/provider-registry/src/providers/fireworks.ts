import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'fireworks',
  name: 'Fireworks',
  baseUrl: 'https://api.fireworks.ai/inference',
  website: {
    apiKey: 'https://fireworks.ai/account/api-keys',
    docs: 'https://docs.fireworks.ai/getting-started/introduction',
    models: 'https://fireworks.ai/dashboard/models',
    official: 'https://fireworks.ai/'
  },
  modelsDevProvider: 'fireworks-ai'
})
