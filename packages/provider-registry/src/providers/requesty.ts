import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'requesty',
  name: 'Requesty',
  availableInEditions: ['global'],
  baseUrl: 'https://router.requesty.ai/v1',
  anthropic: 'https://router.requesty.ai',
  website: {
    apiKey: 'https://app.requesty.ai/api-keys',
    docs: 'https://docs.requesty.ai',
    models: 'https://www.requesty.ai/models',
    official: 'https://requesty.ai/'
  }
})
