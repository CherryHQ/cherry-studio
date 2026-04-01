import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import { isSupportedModel } from '@renderer/config/models'
import type { Provider } from '@renderer/types'
import { withoutTrailingSlash } from '@renderer/utils/api'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

const logger = loggerService.withContext('PoeAPIClient')

interface PoeModelEntry {
  id: string
  object: string
  created: number
  description?: string
  owned_by: string
}

interface PoeModelsResponse {
  object: string
  data: PoeModelEntry[]
}

export class PoeAPIClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  override getClientCompatibilityType(): string[] {
    return ['OpenAIAPIClient']
  }

  /**
   * Fetch models from Poe's /v1/models endpoint directly via fetch,
   * bypassing the OpenAI SDK which injects an Authorization header.
   * Poe's models endpoint does not require authentication, and sending
   * an empty Bearer token causes a 401 rejection.
   */
  override async listModels(): Promise<OpenAI.Models.Model[]> {
    try {
      const baseUrl = withoutTrailingSlash(this.getBaseURL())
      const url = `${baseUrl}/models`

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...this.provider.extra_headers
        }
      })

      if (!response.ok) {
        throw new Error(`Poe API returned ${response.status} ${response.statusText}`)
      }

      const data: PoeModelsResponse = await response.json()

      if (!data?.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response from Poe models API: missing data array')
      }

      return data.data
        .map((model) => ({
          id: model.id,
          object: 'model' as const,
          created: Math.floor(model.created / 1000),
          description: model.description,
          owned_by: model.owned_by
        }))
        .filter(isSupportedModel)
    } catch (error) {
      logger.error('Error listing Poe models:', error as Error)
      return []
    }
  }
}
