import BaiduLogo from '@renderer/assets/images/search/baidu.svg'
import BingLogo from '@renderer/assets/images/search/bing.svg'
import BochaLogo from '@renderer/assets/images/search/bocha.webp'
import ExaLogo from '@renderer/assets/images/search/exa.png'
import GoogleLogo from '@renderer/assets/images/search/google.svg'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import ZhipuLogo from '@renderer/assets/images/search/zhipu.png'
import type { WebSearchProviderId } from '@renderer/types'

export const WEB_SEARCH_PROVIDER_LOGOS: Record<WebSearchProviderId, string> = {
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

export const getWebSearchProviderLogo = (providerId: WebSearchProviderId) => {
  return WEB_SEARCH_PROVIDER_LOGOS[providerId]
}
