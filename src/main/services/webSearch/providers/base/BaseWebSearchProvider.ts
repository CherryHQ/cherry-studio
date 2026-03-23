import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { withoutTrailingSlash } from '@shared/utils'

import { resolveProviderApiHost } from '../../utils/provider'

export abstract class BaseWebSearchProvider {
  constructor(protected readonly provider: ResolvedWebSearchProvider) {}

  abstract search(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse>

  protected resolveApiUrl(path: string): string {
    const apiHost = resolveProviderApiHost(this.provider)
    const normalizedBaseUrl = `${withoutTrailingSlash(apiHost)}/`
    const normalizedPath = path.replace(/^\//, '')
    return new URL(normalizedPath, normalizedBaseUrl).toString()
  }
}
