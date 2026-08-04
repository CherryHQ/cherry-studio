import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'zai',
  name: 'zai',
  baseUrl: 'https://api.z.ai/api/paas/v4/',
  anthropic: 'https://api.z.ai/api/anthropic',
  website: {
    apiKey: 'https://z.ai/manage-apikey/apikey-list',
    docs: 'https://docs.z.ai/',
    models: 'https://docs.z.ai/models',
    official: 'https://z.ai'
  },
  presetProviderId: 'zhipu'
})
