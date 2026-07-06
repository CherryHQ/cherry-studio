import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'minimax',
  name: 'MiniMax',
  baseUrl: 'https://api.minimaxi.com/v1/',
  anthropic: 'https://api.minimaxi.com/anthropic',
  website: {
    apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docs: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
    models: 'https://platform.minimaxi.com/document/Models',
    official: 'https://platform.minimaxi.com/'
  },
  apiFeatures: {
    arrayContent: false
  }
})
