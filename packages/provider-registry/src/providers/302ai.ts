import { openaiCompatible } from './types'

export default openaiCompatible({
  id: '302ai',
  name: '302.AI',
  baseUrl: 'https://api.302.ai',
  anthropic: 'https://api.302.ai',
  website: {
    apiKey: 'https://dash.302.ai/apis/list',
    docs: 'https://302ai.apifox.cn/api-147522039',
    models: 'https://302.ai/pricing/',
    official: 'https://302.ai'
  },
  modelsDevProvider: '302ai'
})
