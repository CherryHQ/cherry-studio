import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'
import { modeWire } from './wires'

const thinkingWire: ReasoningWireProfile = modeWire('chat_template_kwargs.thinking', {
  off: false,
  auto: true
})

export default openaiCompatible({
  id: 'watt-cloud',
  name: 'Watt Cloud',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.watt-cloud.com/v1',
  reasoningFormat: { type: 'openai-chat', wire: thinkingWire },
  website: {
    apiKey: 'https://www.watt-cloud.com/workspaces/keys',
    docs: 'https://www.watt-cloud.com/docs/',
    official: 'https://www.watt-cloud.com'
  }
})
