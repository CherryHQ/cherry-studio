import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'
import { modeWire } from './wires'

// Token Market exposes model-dependent reasoning through the OpenAI-compatible
// `enable_thinking` request field. Encoding remains gated by model capability.
const thinkingWire: ReasoningWireProfile = modeWire('enable_thinking', { off: false, auto: true })

export default openaiCompatible({
  id: 'tokensmarket',
  name: 'Token Market',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.tokensmarket.ai/v1',
  reasoningFormat: { type: 'openai-chat', wire: thinkingWire },
  website: {
    apiKey: 'https://www.tokensmarket.ai/console',
    docs: 'https://www.tokensmarket.ai/docs',
    models: 'https://www.tokensmarket.ai/models',
    official: 'https://www.tokensmarket.ai'
  }
})
