import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'orcarouter',
  name: 'OrcaRouter',
  baseUrl: 'https://api.orcarouter.ai/v1/',
  website: {
    official: 'https://www.orcarouter.ai/',
    apiKey: 'https://www.orcarouter.ai/console',
    docs: 'https://docs.orcarouter.ai',
    models: 'https://www.orcarouter.ai/models'
  }
})
