import {
  isKeywordSearchProviderId,
  isUrlSearchProviderId,
  type KeywordSearchProviderId,
  type UrlSearchProviderId
} from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

import { BochaProvider } from './api/BochaProvider'
import { ExaProvider } from './api/ExaProvider'
import { FetchProvider } from './api/FetchProvider'
import { JinaReaderProvider } from './api/JinaReaderProvider'
import { QueritProvider } from './api/QueritProvider'
import { SearxngProvider } from './api/SearxngProvider'
import { TavilyProvider } from './api/TavilyProvider'
import { ZhipuProvider } from './api/ZhipuProvider'
import type { BaseWebSearchProvider } from './base/BaseWebSearchProvider'
import { ExaMcpProvider } from './mcp/ExaMcpProvider'

type KeywordSearchProvider = ResolvedWebSearchProvider & {
  id: KeywordSearchProviderId
}

type UrlSearchProvider = ResolvedWebSearchProvider & {
  id: UrlSearchProviderId
}

export function createKeywordSearchProvider(provider: KeywordSearchProvider): BaseWebSearchProvider {
  if (!isKeywordSearchProviderId(provider.id)) {
    throw new Error(`Unsupported keyword search provider: ${provider.id}`)
  }

  switch (provider.id) {
    case 'zhipu':
      return new ZhipuProvider(provider)
    case 'tavily':
      return new TavilyProvider(provider)
    case 'searxng':
      return new SearxngProvider(provider)
    case 'exa':
      return new ExaProvider(provider)
    case 'exa-mcp':
      return new ExaMcpProvider(provider)
    case 'bocha':
      return new BochaProvider(provider)
    case 'querit':
      return new QueritProvider(provider)
  }
}

export function createUrlSearchProvider(provider: UrlSearchProvider): BaseWebSearchProvider {
  if (!isUrlSearchProviderId(provider.id)) {
    throw new Error(`Unsupported URL search provider: ${provider.id}`)
  }

  switch (provider.id) {
    case 'fetch':
      return new FetchProvider(provider)
    case 'jina-reader':
      return new JinaReaderProvider(provider)
  }
}
