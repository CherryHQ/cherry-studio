import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'uberllm',
  name: 'UberLLM',
  availableInEditions: ['global'],
  baseUrl: 'https://api.uberllm.dev',
  anthropic: 'https://api.uberllm.dev',
  website: {
    apiKey: 'https://uberllm.dev/dashboard/keys',
    docs: 'https://uberllm.dev/docs',
    models: 'https://uberllm.dev/models',
    official: 'https://uberllm.dev'
  }
})
