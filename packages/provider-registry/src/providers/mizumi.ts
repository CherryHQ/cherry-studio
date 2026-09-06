import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'mizumi',
  name: 'Mizumi',
  availableInEditions: ['global'],
  baseUrl: 'https://api.mizumi.co/v1',
  website: {
    apiKey: 'https://mizumi.co',
    docs: 'https://mizumi.co/docs',
    models: 'https://mizumi.co/docs',
    official: 'https://mizumi.co'
  },
  overrides: [
    { apiModelId: 'gpt-5.6-sol', modelId: 'gpt-5-6-sol', name: 'GPT-5.6 Sol' },
    { apiModelId: 'gpt-5.6-terra', modelId: 'gpt-5-6-terra', name: 'GPT-5.6 Terra' },
    { apiModelId: 'gpt-5.6-luna', modelId: 'gpt-5-6-luna', name: 'GPT-5.6 Luna' },
    { apiModelId: 'gpt-5.5', modelId: 'gpt-5-5', name: 'GPT-5.5' },
    { apiModelId: 'gpt-5.4', modelId: 'gpt-5-4', name: 'GPT-5.4' },
    { apiModelId: 'gpt-4.1-mini', modelId: 'gpt-4-1-mini', name: 'GPT-4.1 Mini' }
  ]
})
