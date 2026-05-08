import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

import type { ApiKeyRotationState } from '../utils/provider'
import { BochaProvider } from './api/BochaProvider'
import { ExaProvider } from './api/ExaProvider'
import { FetchProvider } from './api/FetchProvider'
import { JinaProvider } from './api/JinaProvider'
import { QueritProvider } from './api/QueritProvider'
import { SearxngProvider } from './api/SearxngProvider'
import { TavilyProvider } from './api/TavilyProvider'
import { ZhipuProvider } from './api/ZhipuProvider'
import type { WebSearchProviderDriver } from './factory'
import { ExaMcpProvider } from './mcp/ExaMcpProvider'

type WebSearchProviderConstructor = new (
  provider: ResolvedWebSearchProvider,
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
  jina: JinaProvider
} as const satisfies Record<ResolvedWebSearchProvider['id'], WebSearchProviderConstructor>
