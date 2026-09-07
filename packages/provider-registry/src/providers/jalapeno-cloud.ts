import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'
import { modeWire } from './wires'

// Live `/v1/models` catalog: one endpoint thinking wire. Encoding still
// requires `model.reasoning` (id inference / user capability), not every SKU.
const thinkingWire: ReasoningWireProfile = modeWire('chat_template_kwargs.thinking', { off: false, auto: true })

export default openaiCompatible({
  id: 'jalapeno-cloud',
  name: 'Jalapeno Cloud',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.jalapeno-cloud.ai/v1',
  reasoningFormat: { type: 'openai-chat', wire: thinkingWire },
  website: {
    apiKey: 'https://www.jalapeno-cloud.ai/keys/',
    docs: 'https://www.jalapeno-cloud.ai/docs',
    models: 'https://www.jalapeno-cloud.ai/models',
    official: 'https://www.jalapeno-cloud.ai'
  }
})
