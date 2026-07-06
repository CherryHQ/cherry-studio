import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'qiniu',
  name: 'Qiniu',
  baseUrl: 'https://api.qnaigc.com',
  anthropic: 'https://api.qnaigc.com',
  website: {
    apiKey: 'https://portal.qiniu.com/ai-inference/api-key',
    docs: 'https://developer.qiniu.com/aitokenapi',
    models: 'https://developer.qiniu.com/aitokenapi/12883/model-list',
    official: 'https://qiniu.com'
  },
  apiFeatures: {
    developerRole: false
  },
  modelsDevProvider: 'qiniu-ai'
})
