import { openaiCompatible } from './types'

// This preset exposes OpenAI Chat Completions and Anthropic Messages.
// Models are discovered from the authenticated /v1/models endpoint; their
// capabilities and reasoning options vary. Jev's separate System One API
// is outside this chat preset. See https://ai.topxea.com/docs/api-reference.
export default openaiCompatible({
  id: 'topxai',
  name: 'TopxAI',
  availableInEditions: ['global'],
  baseUrl: 'https://ai.topxea.com/v1',
  anthropic: 'https://ai.topxea.com',
  reasoningFormat: { type: 'openai-chat' },
  website: {
    apiKey: 'https://ai.topxea.com/keys',
    docs: 'https://ai.topxea.com/docs',
    models: 'https://ai.topxea.com/pricing',
    official: 'https://ai.topxea.com'
  }
})
