import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'

import type { ApiKeyRotationState } from '../utils/provider'
import { BochaProvider } from './api/BochaProvider'
import { Crawl4AIProvider } from './api/Crawl4AIProvider'
import { ExaProvider } from './api/ExaProvider'
import { FetchProvider } from './api/FetchProvider'
import { FirecrawlProvider } from './api/FirecrawlProvider'
import { JinaProvider } from './api/JinaProvider'
import { ParallelProvider } from './api/ParallelProvider'
import { QueritProvider } from './api/QueritProvider'
import { SearxngProvider } from './api/SearxngProvider'
import { SerpKiteProvider } from './api/SerpKiteProvider'
import { SerplyProvider } from './api/SerplyProvider'
import { TavilyProvider } from './api/TavilyProvider'
import { ZhipuProvider } from './api/ZhipuProvider'
import type { WebSearchProviderDriver } from './factory'
import { ExaMcpProvider } from './mcp/ExaMcpProvider'

type WebSearchProviderConstructor = new (
  provider: WebSearchProvider,
  apiKeyRotationState: ApiKeyRotationState
) => WebSearchProviderDriver

export const WEB_SEARCH_PROVIDER_REGISTRY = {
  zhipu: ZhipuProvider,
  tavily: TavilyProvider,
  searxng: SearxngProvider,
  exa: ExaProvider,
  'exa-mcp': ExaMcpProvider,
  bocha: BochaProvider,
  querit: QueritProvider,
  fetch: FetchProvider,
  jina: JinaProvider,
  firecrawl: FirecrawlProvider,
  crawl4ai: Crawl4AIProvider,
  parallel: ParallelProvider,
  serply: SerplyProvider,
  serpkite: SerpKiteProvider
} as const satisfies Record<WebSearchProvider['id'], WebSearchProviderConstructor>
