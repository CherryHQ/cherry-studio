import { openaiCompatible } from './types'

/**
 * Ezkielyna is a prepaid API gateway. Which models a key can call depends on the key's group, so the
 * list comes from `/v1/models` at run time instead of a catalog shipped here.
 */
export default openaiCompatible({
  id: 'ezkielyna',
  name: 'Ezkielyna',
  availableInEditions: ['global'],
  baseUrl: 'https://api.ezkielyna.store',
  anthropic: 'https://api.ezkielyna.store',
  website: {
    apiKey: 'https://api.ezkielyna.store/console/token',
    docs: 'https://ezkielyna.store/panduan/cherry-studio',
    models: 'https://ezkielyna.store/models',
    official: 'https://ezkielyna.store'
  }
})
