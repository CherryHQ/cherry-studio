import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'sophnet',
  name: 'SophNet',
  baseUrl: 'https://www.sophnet.com/api/open-apis/v1',
  website: {
    apiKey: 'https://sophnet.com/#/project/key',
    docs: 'https://sophnet.com/docs/component/introduce.html',
    models: 'https://sophnet.com/#/model/list',
    official: 'https://sophnet.com'
  },
  overrides: [
    { apiModelId: 'DeepSeek-R1-0528', modelId: 'deepseek-r1' },
    { apiModelId: 'DeepSeek-v3', modelId: 'deepseek-v3' }
  ]
})
