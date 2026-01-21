import BaiduLogo from '@renderer/assets/images/search/baidu.svg'
import BingLogo from '@renderer/assets/images/search/bing.svg'
import BochaLogo from '@renderer/assets/images/search/bocha.webp'
import ExaLogo from '@renderer/assets/images/search/exa.png'
import GoogleLogo from '@renderer/assets/images/search/google.svg'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import ZhipuLogo from '@renderer/assets/images/search/zhipu.png'
import type {
  WebSearchProvider,
  WebSearchProviderType,
  WebSearchProviderUserConfig
} from '@shared/data/preference/preferenceTypes'

// ============================================================================
// Provider Templates (Immutable Data)
// ============================================================================

/**
 * WebSearch Provider Template
 * Contains immutable data that doesn't need to be stored in Preference
 */
export interface WebSearchProviderTemplate {
  /** Unique provider identifier */
  id: string
  /** Display name */
  name: string
  /** Provider type */
  type: WebSearchProviderType
  /** Whether to use browser for search */
  usingBrowser: boolean
  /** Default API host (used when user hasn't overridden) */
  defaultApiHost: string
}

/**
 * All available WebSearch provider templates
 * Template data is immutable and stored in code, not in Preference
 */
export const WEB_SEARCH_PROVIDER_TEMPLATES: WebSearchProviderTemplate[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.tavily.com'
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: ''
  },
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.exa.ai'
  },
  {
    id: 'exa-mcp',
    name: 'ExaMCP',
    type: 'mcp',
    usingBrowser: false,
    defaultApiHost: 'https://mcp.exa.ai/mcp'
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.bochaai.com'
  },
  {
    id: 'local-google',
    name: 'Google',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'local-bing',
    name: 'Bing',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
  },
  {
    id: 'local-baidu',
    name: 'Baidu',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.baidu.com/s?wd=%s'
  }
]

/**
 * Get provider template by ID
 */
export function getProviderTemplate(id: string): WebSearchProviderTemplate | undefined {
  return WEB_SEARCH_PROVIDER_TEMPLATES.find((t) => t.id === id)
}

/**
 * Merge template with user config to create full provider
 * @param template - Provider template (immutable)
 * @param userConfig - User config (sparse object, optional)
 * @returns Full WebSearchProvider for runtime use
 */
export function mergeProviderConfig(
  template: WebSearchProviderTemplate,
  userConfig?: WebSearchProviderUserConfig
): WebSearchProvider {
  return {
    id: template.id,
    name: template.name,
    type: template.type,
    usingBrowser: template.usingBrowser,
    apiHost: userConfig?.apiHost || template.defaultApiHost,
    apiKey: userConfig?.apiKey || '',
    engines: userConfig?.engines || [],
    basicAuthUsername: userConfig?.basicAuthUsername || '',
    basicAuthPassword: userConfig?.basicAuthPassword || ''
  }
}

/**
 * Get all providers merged with user configs
 * @param userConfigs - Array of user configs from preference
 * @returns Array of full WebSearchProvider for runtime use
 */
export function getAllProviders(userConfigs: WebSearchProviderUserConfig[]): WebSearchProvider[] {
  return WEB_SEARCH_PROVIDER_TEMPLATES.map((template) => {
    const userConfig = userConfigs.find((c) => c.id === template.id)
    return mergeProviderConfig(template, userConfig)
  })
}

// ============================================================================
// Provider Static Metadata (Websites, Logos)
// ============================================================================

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
 * Provider website links
 * Accessed via WEB_SEARCH_PROVIDER_WEBSITES[providerId]
 */
export const WEB_SEARCH_PROVIDER_WEBSITES: Record<string, WebSearchProviderWebsites> = {
  zhipu: {
    official: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
    apiKey: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
  },
  tavily: {
    official: 'https://tavily.com',
    apiKey: 'https://app.tavily.com/home'
  },
  searxng: {
    official: 'https://docs.searxng.org'
  },
  exa: {
    official: 'https://exa.ai',
    apiKey: 'https://dashboard.exa.ai/api-keys'
  },
  'exa-mcp': {
    official: 'https://exa.ai'
  },
  bocha: {
    official: 'https://bochaai.com',
    apiKey: 'https://open.bochaai.com/overview'
  },
  'local-google': {
    official: 'https://www.google.com'
  },
  'local-bing': {
    official: 'https://www.bing.com'
  },
  'local-baidu': {
    official: 'https://www.baidu.com'
  }
}

/**
 * Provider logo assets
 * Accessed via WEB_SEARCH_PROVIDER_LOGOS[providerId]
 */
export const WEB_SEARCH_PROVIDER_LOGOS: Record<string, string> = {
  zhipu: ZhipuLogo,
  tavily: TavilyLogo,
  searxng: SearxngLogo,
  exa: ExaLogo,
  'exa-mcp': ExaLogo,
  bocha: BochaLogo,
  'local-google': GoogleLogo,
  'local-bing': BingLogo,
  'local-baidu': BaiduLogo
}

/**
 * Get provider websites by ID
 */
export function getProviderWebsites(id: string): WebSearchProviderWebsites | undefined {
  return WEB_SEARCH_PROVIDER_WEBSITES[id]
}

/**
 * Get provider logo asset by ID
 */
export function getProviderLogo(id: string): string | undefined {
  return WEB_SEARCH_PROVIDER_LOGOS[id]
}
