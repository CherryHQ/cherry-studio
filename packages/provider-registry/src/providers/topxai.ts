import { openaiCompatible } from './types'

// TopxAI relays Claude, GPT, Grok, GLM, Kimi, DeepSeek and Jev through one
// prepaid key. `/v1` is OpenAI-compatible (chat completions and responses) and
// forwards `reasoning_effort` unchanged; the Claude models are also served on
// an Anthropic Messages endpoint at the host root. `/v1/models` needs the key,
// so the model list follows the live API. Prices: https://ai.topxea.com/pricing
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
