import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'oceantoken',
  name: 'OceanToken',
  availableInEditions: ['global'],
  baseUrl: 'https://api.oceantoken.ai/v1',
  website: {
    apiKey: 'https://app.oceantoken.ai/ui/?page=api-keys',
    docs: 'https://docs.oceantoken.ai/',
    models: 'https://app.oceantoken.ai/ui/model_hub/',
    official: 'https://oceantoken.ai/'
  }
})
