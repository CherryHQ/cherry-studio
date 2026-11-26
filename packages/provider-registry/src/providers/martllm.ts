import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'martllm',
  name: 'MartLLM',
  availableInEditions: ['global'],
  baseUrl: 'https://api.martllm.com',
  anthropic: 'https://api.martllm.com',
  website: {
    apiKey: 'https://martllm.com/dashboard/keys',
    docs: 'https://martllm.com/docs',
    models: 'https://martllm.com/models',
    official: 'https://martllm.com'
  }
})
