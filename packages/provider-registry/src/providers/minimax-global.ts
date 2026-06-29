import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'minimax-global',
  name: 'minimax-global',
  baseUrl: 'https://api.minimax.io/v1/',
  anthropic: 'https://api.minimax.io/anthropic',
  website: {
    apiKey: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    docs: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
    models: 'https://platform.minimax.io/document/Models',
    official: 'https://platform.minimax.io/'
  },
  presetProviderId: 'minimax'
})
