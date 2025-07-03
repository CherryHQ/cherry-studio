import { Provider } from '@types'

import { BaseFileService } from './BaseFileService'
import { GeminiService } from './GeminiService'
import { MistralService } from './MistralService'

export class FileServiceManager {
  private static instance: FileServiceManager
  private services: Map<string, BaseFileService> = new Map()

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): FileServiceManager {
    if (!this.instance) {
      this.instance = new FileServiceManager()
    }
    return this.instance
  }

  getService(provider: Provider): BaseFileService {
    const type = provider.type
    let service = this.services.get(type)

    if (!service) {
      switch (type) {
        case 'gemini':
          service = new GeminiService(provider)
          break
        case 'mistral':
          service = new MistralService(provider)
          break
        default:
          throw new Error(`Unsupported service type: ${type}`)
      }
      this.services.set(type, service)
    }

    return service
  }
}
