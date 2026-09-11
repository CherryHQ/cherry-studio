import { CURRENCY } from '../schemas/enums'
import { openaiCompatible } from './types'

// Connection only: the compatibility endpoint takes a static bearer key and serves
// the model list from `/v1/models`, so the catalog stays live rather than pinned here.
export default openaiCompatible({
  id: 'anonrouter',
  name: 'AnonRouter',
  availableInEditions: ['global'],
  // AnonRouter returns the billed USD amount as `usage.cost`.
  reportsActualCost: true,
  reportedCostCurrency: CURRENCY.USD,
  baseUrl: 'https://api.anonrouter.ai/v1',
  website: {
    apiKey: 'https://anonrouter.ai/home/api-keys',
    docs: 'https://docs.anonrouter.ai/compatibility',
    models: 'https://anonrouter.ai/models',
    official: 'https://anonrouter.ai'
  }
})
