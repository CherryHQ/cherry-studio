import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'modelrush',
  name: 'ModelRush',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.modelrush.ai/v1',
  website: {
    apiKey: 'https://modelrush.ai/dashboard',
    docs: 'https://modelrush.ai/docs',
    models: 'https://modelrush.ai/models',
    official: 'https://modelrush.ai'
  }
})
