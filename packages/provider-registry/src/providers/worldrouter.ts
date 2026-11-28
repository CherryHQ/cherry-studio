import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'worldrouter',
  name: 'WorldRouter',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://inference-api.worldrouter.ai/v1',
  website: {
    apiKey: 'https://www.worldrouter.ai/',
    docs: 'https://www.worldrouter.ai/docs/quickstart',
    models: 'https://www.worldrouter.ai/models',
    official: 'https://www.worldrouter.ai/'
  }
})
