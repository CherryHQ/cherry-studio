import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'hyperbolic',
  name: 'Hyperbolic',
  baseUrl: 'https://api.hyperbolic.xyz',
  website: {
    apiKey: 'https://app.hyperbolic.xyz/settings',
    docs: 'https://docs.hyperbolic.xyz',
    models: 'https://app.hyperbolic.xyz/models',
    official: 'https://app.hyperbolic.xyz'
  }
})
