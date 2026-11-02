import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'

import type { ApiKeyRotationState } from '../utils/provider'
import { BochaProvider } from './api/BochaProvider'
import { Crawl4AIProvider } from './api/Crawl4AIProvider'
import { DeepSeekProvider } from './api/DeepSeekProvider'
import { DuckduckgoProvider } from './api/DuckduckgoProvider'
import { ExaProvider } from './api/ExaProvider'
import { FetchProvider } from './api/FetchProvider'
import { FirecrawlProvider } from './api/FirecrawlProvider'
import { JinaProvider } from './api/JinaProvider'
import { ParallelProvider } from './api/ParallelProvider'
import { QueritProvider } from './api/QueritProvider'
import { SearchApiProvider } from './api/SearchApiProvider'
import { SearxngProvider } from './api/SearxngProvider'
import { SerplyProvider } from './api/SerplyProvider'
import { TavilyProvider } from './api/TavilyProvider'
import { YuanbaoProvider } from './api/YuanbaoProvider'
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
  yuanbao: YuanbaoProvider,
  deepseek: DeepSeekProvider,
  searchapi: SearchApiProvider,
  duckduckgo: DuckduckgoProvider
} as const satisfies Record<WebSearchProvider['id'], WebSearchProviderConstructor>
