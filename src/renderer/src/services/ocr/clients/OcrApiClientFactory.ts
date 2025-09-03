import { loggerService } from '@logger'
import { OcrApiProvider } from '@renderer/types'

import { OcrBaseApiClient } from './OcrBaseApiClient'
import { OcrExampleApiClient } from './OcrExampleApiClient'

const logger = loggerService.withContext('OcrApiClientFactory')

export class OcrApiClientFactory {
  /**
   * Create an ApiClient instance for the given provider
   * 为给定的提供者创建ApiClient实例
   */
  static create(provider: OcrApiProvider): OcrBaseApiClient {
    logger.debug(`Creating ApiClient for provider:`, {
      id: provider.id,
      config: provider.config
    })

    let instance: OcrBaseApiClient

    // Extend other clients here
    // eslint-disable-next-line prefer-const
    instance = new OcrExampleApiClient(provider)

    return instance
  }
}
