import BaiduLogo from '@renderer/assets/images/search/baidu.svg'
import BingLogo from '@renderer/assets/images/search/bing.svg'
import BochaLogo from '@renderer/assets/images/search/bocha.webp'
import ExaLogo from '@renderer/assets/images/search/exa.png'
import GoogleLogo from '@renderer/assets/images/search/google.svg'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import ZhipuLogo from '@renderer/assets/images/search/zhipu.png'

/**
 * WebSearch Provider Static Metadata
 *
 * Contains static metadata for providers that doesn't need to be stored in Preference.
 * Provider configuration (id, name, type, apiHost, etc.) is stored in Preference.
 */

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
