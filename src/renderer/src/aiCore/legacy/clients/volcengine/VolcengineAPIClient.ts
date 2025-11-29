import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import { getVolcengineProjectName, getVolcengineRegion } from '@renderer/hooks/useVolcengine'
import type { Provider } from '@renderer/types'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

const logger = loggerService.withContext('VolcengineAPIClient')

/**
 * Volcengine (Doubao) API Client
 *
 * Extends OpenAIAPIClient for standard chat completions (OpenAI-compatible),
 * but overrides listModels to use Volcengine's signed API via IPC.
 */
export class VolcengineAPIClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  /**
   * List models using Volcengine's signed API
   * This calls the main process VolcengineService which handles HMAC-SHA256 signing
   */
  override async listModels(): Promise<OpenAI.Models.Model[]> {
    try {
      const hasCredentials = await window.api.volcengine.hasCredentials()

      if (!hasCredentials) {
        logger.info('Volcengine credentials not configured, falling back to OpenAI-compatible list')
        // Fall back to standard OpenAI-compatible API if no Volcengine credentials
        return super.listModels()
      }

      logger.info('Fetching models from Volcengine API using signed request')

      const projectName = getVolcengineProjectName()
      const region = getVolcengineRegion()
      const response = await window.api.volcengine.listModels(projectName, region)

      if (!response || !response.models) {
        logger.warn('Empty response from Volcengine listModels')
        return []
      }

      // Notify user of any partial failures
      if (response.warnings && response.warnings.length > 0) {
        for (const warning of response.warnings) {
          logger.warn(warning)
        }
        window.toast?.warning('Some Volcengine models could not be fetched. Check logs for details.')
      }

      const models: OpenAI.Models.Model[] = response.models.map((model) => ({
        id: model.id,
        object: 'model' as const,
        created: model.created || Math.floor(Date.now() / 1000),
        owned_by: 'volcengine',
        // @ts-ignore - description is used by UI to display model name
        name: model.name || model.id
      }))

      logger.info(`Found ${models.length} models from Volcengine API`)
      return models
    } catch (error) {
      logger.error('Failed to list Volcengine models:', error as Error)
      // Notify user before falling back
      window.toast?.warning('Failed to fetch Volcengine models. Check credentials if this persists.')
      // Fall back to standard OpenAI-compatible API on error
      logger.info('Falling back to OpenAI-compatible model list')
      return super.listModels()
    }
  }
}
