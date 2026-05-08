import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { withoutTrailingSlash } from '@shared/utils'
import type * as z from 'zod'

import type { ApiKeyRotationState } from '../../utils/provider'
import { resolveProviderApiHost } from '../../utils/provider'

const MAX_HTTP_ERROR_TEXT_LENGTH = 500

export abstract class BaseWebSearchProvider {
  constructor(
    protected readonly provider: ResolvedWebSearchProvider,
    private readonly apiKeyRotationState: ApiKeyRotationState
  ) {}

  protected resolveApiUrl(capability: WebSearchCapability, path: string): string {
    const apiHost = resolveProviderApiHost(this.provider, capability)
    const normalizedBaseUrl = `${withoutTrailingSlash(apiHost)}/`
    const normalizedPath = path.replace(/^\//, '')
    return new URL(normalizedPath, normalizedBaseUrl).toString()
  }

  protected resolveApiKey(required: boolean = true): string {
    return this.apiKeyRotationState.resolve(this.provider, required)
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

  protected async throwHttpError(message: string, response: Response): Promise<never> {
    const errorText = (await response.text()).trim()

    if (!errorText) {
      throw new Error(`${message}: HTTP ${response.status}`)
    }

    const truncatedErrorText =
      errorText.length > MAX_HTTP_ERROR_TEXT_LENGTH
        ? `${errorText.slice(0, MAX_HTTP_ERROR_TEXT_LENGTH)}... [truncated]`
        : errorText

    throw new Error(`${message}: HTTP ${response.status} ${truncatedErrorText}`)
  }
}
