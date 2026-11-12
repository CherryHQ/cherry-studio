import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'tokenlab',
  name: 'TokenLab',
  // Models are listed by the public GET /v1/models endpoint; no hand-written model list or pricing.
  supplementModelsFromRegistry: true,
  availableInEditions: ['global'],
  baseUrl: 'https://api.tokenlab.sh/v1',
  website: {
    apiKey: 'https://tokenlab.sh/?utm_source=cherry-studio',
    docs: 'https://tokenlab.sh/docs/en/integrations/cherry-studio?utm_source=cherry-studio',
    models: 'https://tokenlab.sh/en/pricing?utm_source=cherry-studio',
    official: 'https://tokenlab.sh/?utm_source=cherry-studio'
  }
})
