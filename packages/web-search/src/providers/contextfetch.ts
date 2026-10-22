import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import type { WebSearchProviderModule } from '../types'
import { exa } from './exa'

// ContextFetch serves the Exa search API (same route, auth header and payload), so it reuses the Exa protocol.
export const contextfetch: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['contextfetch'],
  execute: exa.execute
}
