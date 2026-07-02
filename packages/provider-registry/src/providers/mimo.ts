import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'mimo',
  name: 'Xiaomi MiMo',
  baseUrl: 'https://api.xiaomimimo.com',
  anthropic: 'https://api.xiaomimimo.com/anthropic',
  website: {
    apiKey: 'https://platform.xiaomimimo.com/#/console/usage',
    docs: 'https://platform.xiaomimimo.com/#/docs/welcome',
    models: 'https://platform.xiaomimimo.com/',
    official: 'https://platform.xiaomimimo.com/'
  }
})
