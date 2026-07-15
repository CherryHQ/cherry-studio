import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'nvidia',
  name: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com',
  website: {
    apiKey: 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
    docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    models: 'https://build.nvidia.com/nim',
    official: 'https://build.nvidia.com/explore/discover'
  },
  modelsDevProvider: 'nvidia'
})
