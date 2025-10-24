import { loggerService } from '@logger'
import type { OcrApiProvider, OcrApiProviderConfig } from '@renderer/types'

import type { OcrBaseApiClient } from './OcrBaseApiClient'
import { OcrExampleApiClient } from './OcrExampleApiClient'

const logger = loggerService.withContext('OcrApiClientFactory')

// Not being used for now.
// TODO: Migrate to main in the future.
export class OcrApiClientFactory {
  /**
   * Create an ApiClient instance for the given provider
   * 为给定的提供者创建ApiClient实例
   */
  static create(provider: OcrApiProvider, config: OcrApiProviderConfig): OcrBaseApiClient {
    logger.debug(`Creating ApiClient for provider:`, {
      id: provider.id,
      config
    })

    let instance: OcrBaseApiClient

    // Extend other clients here
    // eslint-disable-next-line prefer-const
    instance = new OcrExampleApiClient(provider, config)

    return instance
  }
}
