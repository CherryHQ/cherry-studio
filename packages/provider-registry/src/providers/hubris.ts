import { openaiCompatible } from './types'
import { EFFORT, modeWire } from './wires'

// Live `/v1/models` catalog — open without a key, so the list needs no registry mirror.
// Reasoning is OpenRouter-shaped: `reasoning.effort`, with `none` as the explicit off.
export default openaiCompatible({
  id: 'hubris',
  name: 'Hubris',
  availableInEditions: ['global'],
  baseUrl: 'https://api.hubris.pw/v1',
  anthropic: 'https://api.hubris.pw',
  reasoningFormat: {
    type: 'openai-chat',
    wire: modeWire('reasoning.effort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })
  },
  website: {
    apiKey: 'https://hubris.pw/keys',
    docs: 'https://hubris.pw/docs',
    models: 'https://hubris.pw/models',
    official: 'https://hubris.pw'
  }
})
