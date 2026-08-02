import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'avalai',
  name: 'AvalAI',
  baseUrl: 'https://api.avalai.ir/v1',
  website: {
    apiKey: 'https://avalai.ir',
    docs: 'https://docs.avalai.ir',
    models: 'https://docs.avalai.ir',
    official: 'https://avalai.ir'
  },
  overrides: [
    { modelId: 'gpt-4o', apiModelId: 'gpt-4o' },
    { modelId: 'gpt-4o-mini', apiModelId: 'gpt-4o-mini' },
    { modelId: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5' },
    { modelId: 'gemini-2-5-flash', apiModelId: 'gemini-2.5-flash' },
    { modelId: 'deepseek-chat', apiModelId: 'deepseek-chat' }
  ]
})
