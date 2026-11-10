import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'

import type { ApiKeyRotationState } from '../../utils/provider'

const MAX_HTTP_ERROR_TEXT_LENGTH = 500

export abstract class BaseWebSearchProvider {
  constructor(
    protected readonly provider: WebSearchProvider,
    private readonly apiKeyRotationState: ApiKeyRotationState
  ) {}

  protected resolveApiKey(required: boolean = true): string {
    return this.apiKeyRotationState.resolve(this.provider, required)
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
