import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'llmman',
  name: 'llmman',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  baseUrl: 'http://127.0.0.1:17434',
  anthropic: 'http://127.0.0.1:17434',
  reasoningFormat: { type: 'openai-chat' },
  website: {
    docs: 'https://github.com/llmmanorg/llmman',
    models: 'https://hub.docker.com/catalogs/models',
    official: 'https://github.com/llmmanorg/llmman'
  }
})
