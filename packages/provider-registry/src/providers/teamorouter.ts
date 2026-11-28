import { openaiCompatible } from './types'

// One key for Claude / GPT / Gemini / DeepSeek / GLM / Kimi / Qwen. OpenAI-compatible chat on `/v1`;
// Claude is also served over the native Anthropic Messages API at the bare host (no `/v1`).
export default openaiCompatible({
  id: 'teamorouter',
  name: 'TeamoRouter',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.teamorouter.com/v1',
  anthropic: 'https://api.teamorouter.com',
  website: {
    apiKey: 'https://teamorouter.com/dashboard',
    docs: 'https://teamorouter.com/docs',
    models: 'https://teamorouter.com/models',
    official: 'https://teamorouter.com'
  }
})
