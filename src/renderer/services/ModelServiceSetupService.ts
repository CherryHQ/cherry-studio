import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ModelServiceSetupService')

export type ModelServiceSetupFilter = (model: Model, provider?: Provider) => boolean
export type ModelServiceSetupContext = 'chat' | 'agent'

export interface ModelServiceSetupRequest {
  setupContext: ModelServiceSetupContext
  initialProviderId?: string
  modelFilter?: ModelServiceSetupFilter
  onCloseAutoFocus?: () => void
}

export type ModelServiceSetupResult = Model[] | null

type ModelServiceSetupHandler = (request: ModelServiceSetupRequest) => Promise<ModelServiceSetupResult>

class ModelServiceSetupService {
  private handler: ModelServiceSetupHandler | null = null

  register(handler: ModelServiceSetupHandler): () => void {
    this.handler = handler

    return () => {
      if (this.handler === handler) {
        this.handler = null
      }
    }
  }

  open(request: ModelServiceSetupRequest): Promise<ModelServiceSetupResult> {
    if (!this.handler) {
      logger.warn('Model service setup requested without a registered popup host')
      return Promise.resolve(null)
    }

    return this.handler(request)
  }
}

export const modelServiceSetupService = new ModelServiceSetupService()
