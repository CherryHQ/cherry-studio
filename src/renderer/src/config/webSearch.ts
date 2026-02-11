import BaiduLogo from '@renderer/assets/images/search/baidu.svg'
import BingLogo from '@renderer/assets/images/search/bing.svg'
import BochaLogo from '@renderer/assets/images/search/bocha.webp'
import ExaLogo from '@renderer/assets/images/search/exa.png'
import GoogleLogo from '@renderer/assets/images/search/google.svg'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import ZhipuLogo from '@renderer/assets/images/search/zhipu.png'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type {
  WebSearchProviderOverride,
  WebSearchProviderOverrides,
  WebSearchProviderPreset
} from '@shared/data/presets/web-search-providers'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'

// ============================================================================
// Provider Presets (Immutable Data)
// ============================================================================

/**
 * Get provider preset by ID
 */
export function getProviderTemplate(id: string): WebSearchProviderPreset | undefined {
  return PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === id)
}

/**
 * Merge preset with user overrides to create full provider
 * @param template - Provider preset (immutable)
 * @param userConfig - User override (sparse object, optional)
 * @returns Full WebSearchProvider for runtime use
 */
export function mergeProviderConfig(
  template: WebSearchProviderPreset,
  userConfig?: WebSearchProviderOverride
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
 * Get all providers merged with user overrides
 * @param userConfigs - Override map from preference
 * @returns Array of full WebSearchProvider for runtime use
 */
export function getAllProviders(overrides: WebSearchProviderOverrides): WebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((template) => {
    const userConfig = overrides[template.id]
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
