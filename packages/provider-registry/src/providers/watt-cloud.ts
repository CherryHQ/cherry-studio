import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'
import { modeWire } from './wires'

// Watt's thinking flag is a plain boolean with no documented on-by-default
// guarantee, so `default` carries the explicit enable: models synced from the
// endpoint resolve to effort-controlled creator entries, which project this
// wire to Default/Off only, and a persisted Auto normalizes to Default.
const thinkingWire: ReasoningWireProfile = modeWire('chat_template_kwargs.thinking', {
  default: true,
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
