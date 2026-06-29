import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'burncloud',
  name: 'BurnCloud',
  baseUrl: 'https://ai.burncloud.com',
  website: {
    apiKey: 'https://ai.burncloud.com/token',
    docs: 'https://ai.burncloud.com/docs',
    models: 'https://ai.burncloud.com/pricing',
    official: 'https://ai.burncloud.com/'
  }
})
