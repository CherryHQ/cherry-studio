import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'omlx',
  name: 'oMLX',
  baseUrl: 'http://localhost:8000',
  anthropic: 'http://localhost:8000',
  authOptional: true,
  reasoningFormat: { type: 'openai-chat' },
  availableInEditions: ['global', 'cn'],
  website: {
    docs: 'https://github.com/jundot/omlx',
    official: 'https://omlx.ai'
  }
})
