import { cacheService } from '@data/CacheService'
import type { OcrApiProvider, OcrHandler } from '@renderer/types'
export abstract class OcrBaseApiClient {
  public provider: OcrApiProvider
  protected host: string
  protected apiKey: string

  constructor(provider: OcrApiProvider) {
    this.provider = provider
    this.host = this.getHost()
    this.apiKey = this.getApiKey()
  }

  abstract ocr: OcrHandler

  // copy from BaseApiClient
  public getHost(): string {
    return this.provider.config.api.apiHost
  }

  // copy from BaseApiClient
  public getApiKey() {
    const keys = this.provider.config.api.apiKey.split(',').map((key) => key.trim())
    const keyName = `ocr_provider:${this.provider.id}:last_used_key`

    if (keys.length === 1) {
      return keys[0]
    }

    const lastUsedKey = cacheService.getShared(keyName) as string | undefined
    if (lastUsedKey === undefined) {
      cacheService.setShared(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    cacheService.setShared(keyName, nextKey)

    return nextKey
  }
}
