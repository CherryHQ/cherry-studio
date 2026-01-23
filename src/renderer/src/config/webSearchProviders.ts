/**
 * WebSearch Provider Static Metadata
 *
 * This file re-exports from webSearch.ts for backward compatibility.
 * New code should import directly from webSearch.ts.
 */

// Re-export from webSearch.ts (primary location)
export {
  getProviderWebsites,
  WEB_SEARCH_PROVIDER_WEBSITES,
  type WebSearchProviderWebsites
} from './webSearch'

// =============================================================================
// Legacy exports for backward compatibility
// TODO: Remove after Redux store migration is complete
// =============================================================================

import type { LegacyWebSearchProvider } from '@renderer/types'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'

/**
 * @deprecated Use PRESETS_WEB_SEARCH_PROVIDERS from '@shared/data/presets/web-search-providers' instead
 */
export const WEB_SEARCH_PROVIDERS: LegacyWebSearchProvider[] = PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  type: preset.type,
  usingBrowser: preset.usingBrowser,
  apiHost: preset.defaultApiHost
}))
