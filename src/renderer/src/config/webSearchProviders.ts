/**
 * WebSearch Provider Template Definitions
 *
 * Static provider templates - immutable configuration that defines available providers.
 * User-modifiable settings (apiKey, apiHost, etc.) are stored in Preference system.
 *
 * Runtime Usage:
 * - Template data: from this file (id, name, type, websites, defaultApiHost)
 * - User config: from Preference ('websearch.providers')
 * - Merged result: template + user config = complete provider object
 */

/**
 * Provider type
 * - 'api': API-based providers (Tavily, Exa, etc.)
 * - 'local': Browser-based providers (Google, Bing, etc.)
 */
export type WebSearchProviderType = 'api' | 'local'

/**
 * Provider website links for documentation and API key management
 */
export interface WebSearchProviderWebsites {
  /** Official documentation or homepage */
  official: string
  /** API key management page (for API providers) */
  apiKey?: string
}

/**
 * Static provider template - immutable configuration
 */
export interface WebSearchProviderTemplate {
  /** Unique provider identifier */
  id: string
  /** Display name */
  name: string
  /** Provider type */
  type: WebSearchProviderType
  /** Website links */
  websites: WebSearchProviderWebsites
  /** Default API host (can be overridden by user) */
  defaultApiHost?: string
}

/**
 * Provider template definitions
 * These are the 9 pre-configured providers available in the app
 */
export const WEB_SEARCH_PROVIDER_TEMPLATES: WebSearchProviderTemplate[] = [
  // API-based providers
  {
    id: 'zhipu',
    name: 'Zhipu',
    type: 'api',
    websites: {
      official: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
      apiKey: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
    },
    defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    websites: {
      official: 'https://tavily.com',
      apiKey: 'https://app.tavily.com/home'
    },
    defaultApiHost: 'https://api.tavily.com'
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    websites: {
      official: 'https://docs.searxng.org'
    }
    // No default apiHost - user must configure their own SearxNG instance
  },
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    websites: {
      official: 'https://exa.ai',
      apiKey: 'https://dashboard.exa.ai/api-keys'
    },
    defaultApiHost: 'https://api.exa.ai'
  },
  {
    id: 'exa-mcp',
    name: 'ExaMCP',
    type: 'api',
    websites: {
      official: 'https://exa.ai'
    },
    defaultApiHost: 'https://mcp.exa.ai/mcp'
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    websites: {
      official: 'https://bochaai.com',
      apiKey: 'https://open.bochaai.com/overview'
    },
    defaultApiHost: 'https://api.bochaai.com'
  },
  // Local browser-based providers
  {
    id: 'local-google',
    name: 'Google',
    type: 'local',
    websites: {
      official: 'https://www.google.com'
    },
    defaultApiHost: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'local-bing',
    name: 'Bing',
    type: 'local',
    websites: {
      official: 'https://www.bing.com'
    },
    defaultApiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
  },
  {
    id: 'local-baidu',
    name: 'Baidu',
    type: 'local',
    websites: {
      official: 'https://www.baidu.com'
    },
    defaultApiHost: 'https://www.baidu.com/s?wd=%s'
  }
]

/**
 * Get provider template by ID
 */
export function getProviderTemplate(id: string): WebSearchProviderTemplate | undefined {
  return WEB_SEARCH_PROVIDER_TEMPLATES.find((p) => p.id === id)
}

/**
 * Check if a provider ID is valid
 */
export function isValidProviderId(id: string): boolean {
  return WEB_SEARCH_PROVIDER_TEMPLATES.some((p) => p.id === id)
}

// =============================================================================
// Legacy exports for backward compatibility
// TODO: Remove in future version after migration is complete
// =============================================================================

/**
 * @deprecated Use WEB_SEARCH_PROVIDER_TEMPLATES instead
 */
export const WEB_SEARCH_PROVIDER_CONFIG = Object.fromEntries(
  WEB_SEARCH_PROVIDER_TEMPLATES.map((p) => [p.id, { websites: p.websites }])
)

/**
 * @deprecated Use WEB_SEARCH_PROVIDER_TEMPLATES instead
 */
export const WEB_SEARCH_PROVIDERS = WEB_SEARCH_PROVIDER_TEMPLATES.map((p) => ({
  id: p.id,
  name: p.name,
  apiHost: p.defaultApiHost ?? '',
  apiKey: '',
  ...(p.type === 'local' ? { url: p.defaultApiHost } : {})
}))
