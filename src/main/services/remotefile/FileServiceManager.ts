import { providerService } from '@data/services/ProviderService'
import { getBaseUrl } from '@main/ai/utils/provider'
import type { Provider } from '@shared/data/types/provider'

import type { BaseFileService } from './BaseFileService'
import { GeminiService } from './GeminiService'
import { MistralService } from './MistralService'
import { OpenaiService } from './OpenAIService'

export class FileServiceManager {
  private services: Map<string, BaseFileService> = new Map()

  async getService(provider: Provider): Promise<BaseFileService> {
    const id = provider.presetProviderId ?? provider.id
    let service = this.services.get(id)
    if (!service) {
      const apiKey = await providerService.getRotatedApiKey(provider.id)
      const apiHost = getBaseUrl(provider) || undefined
      switch (id) {
        case 'gemini':
          service = new GeminiService(apiKey, apiHost)
          break
        case 'mistral':
          service = new MistralService(apiKey, apiHost)
          break
        case 'openai':
          service = new OpenaiService(apiKey, apiHost)
          break
        default:
          throw new Error(`Unsupported service: ${id}`)
      }
      this.services.set(id, service)
    }

    return service
  }
}

export const fileServiceManager = new FileServiceManager()
