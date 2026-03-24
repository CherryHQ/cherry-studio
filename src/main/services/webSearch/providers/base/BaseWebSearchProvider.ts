import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { withoutTrailingSlash } from '@shared/utils'
import type * as z from 'zod'

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

  protected async parseJsonResponse<T>(
    response: Response,
    schema: z.ZodType<T>,
    context: {
      operation: string
      requestUrl: string
    }
  ): Promise<T> {
    let payload: unknown

    try {
      payload = await response.json()
    } catch (error) {
      throw new Error(`${this.provider.id} ${context.operation} returned invalid JSON from ${context.requestUrl}`, {
        cause: error
      })
    }

    const result = schema.safeParse(payload)

    if (!result.success) {
      throw new Error(
        `${this.provider.id} ${context.operation} response validation failed for ${context.requestUrl}: ${result.error.message}`,
        {
          cause: result.error
        }
      )
    }

    return result.data
  }
}
