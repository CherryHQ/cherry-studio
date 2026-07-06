import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'github',
  name: 'Github Models',
  baseUrl: 'https://models.github.ai/inference',
  website: {
    apiKey: 'https://github.com/settings/tokens',
    docs: 'https://docs.github.com/en/github-models',
    models: 'https://github.com/marketplace/models',
    official: 'https://github.com/marketplace/models'
  },
  modelsDevProvider: 'github-models'
})
