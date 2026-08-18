import { moonshotReasoningFormat, moonshotReasoningOverrides, moonshotServerTools } from './moonshot'
import { openaiCompatible } from './types'

// Moonshot's international endpoint (api.moonshot.ai) — same API and model line as
// the CN preset, served from the global console. Folds under the 'moonshot' preset.
export default openaiCompatible({
  id: 'moonshot-global',
  name: 'moonshot-global',
  baseUrl: 'https://api.moonshot.ai',
  reasoningFormat: moonshotReasoningFormat,
  anthropic: 'https://api.moonshot.ai/anthropic',
  serverTools: moonshotServerTools,
  website: {
    apiKey: 'https://platform.moonshot.ai/console/api-keys',
    docs: 'https://platform.moonshot.ai/docs/',
    models: 'https://platform.moonshot.ai/docs/',
    official: 'https://www.moonshot.ai/'
  },
  presetProviderId: 'moonshot',
  overrides: moonshotReasoningOverrides
})
