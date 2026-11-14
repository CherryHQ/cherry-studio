import { openaiCompatible } from './types'

// This preset exposes OpenAI Chat Completions and Anthropic Messages.
// Models are discovered from the authenticated /v1/models endpoint; their
// capabilities and reasoning options vary. Jev's separate System One API
// is outside this chat preset. See https://api.topxai.xyz/docs/api-reference.
export default openaiCompatible({
  id: 'topxai',
  name: 'TopxAI',
  availableInEditions: ['global'],
  baseUrl: 'https://api.topxai.xyz/v1',
  anthropic: 'https://api.topxai.xyz',
  reasoningFormat: { type: 'openai-chat' },
  website: {
    apiKey: 'https://api.topxai.xyz/keys',
    docs: 'https://api.topxai.xyz/docs',
    models: 'https://api.topxai.xyz/pricing',
    official: 'https://api.topxai.xyz'
  }
})
