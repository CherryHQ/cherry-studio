import { isEqual } from 'es-toolkit/compat'

import { application } from '@application'
import { loggerService } from '@logger'
import { listModels } from '@main/ai/provider/listModels'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { parseUniqueModelId } from '@shared/data/types/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

const logger = loggerService.withContext('CherryInModelSyncService')
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_ATTEMPT_KEY = 'cherryin.models.last_attempt_at'

@Injectable('CherryInModelSyncService')
@ServicePhase(Phase.WhenReady)
export class CherryInModelSyncService extends BaseService {
  private controller: AbortController | null = null
  private stopped = false

  protected onReady(): void {
    this.stopped = false
    const initial = setTimeout(() => {
      void this.check()
      this.registerInterval(() => this.check(), CHECK_INTERVAL_MS)
    }, 30_000)
    initial.unref()
    this.registerDisposable(() => clearTimeout(initial))
  }

  protected onStop(): void {
    this.stopped = true
    this.controller?.abort()
  }

  public async check(): Promise<void> {
    if (this.stopped || this.controller) return

    try {
      const provider = this.getEnabledProvider()
      if (!provider || modelService.list({ providerId: provider.id }).length === 0) return

      const cache = application.get('CacheService')
      const lastAttempt = cache.getPersist(LAST_ATTEMPT_KEY)
      const now = Date.now()
      if (lastAttempt !== null && now - lastAttempt < CHECK_INTERVAL_MS) return

      const controller = new AbortController()
      this.controller = controller
      // Throttle failed and empty pulls too, including across application restarts.
      cache.setPersist(LAST_ATTEMPT_KEY, now)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
      const { models } = await listModels(provider, signal, { throwOnError: true })
      if (signal.aborted || !isEqual(provider, this.getEnabledProvider())) return

      const remote = new Map(
        models.filter((model) => model.endpointTypes?.length).map((model) => [model.apiModelId, model])
      )
      const updates = modelService.list({ providerId: provider.id }).flatMap((model) => {
        const modelId = parseUniqueModelId(model.id).modelId
        const endpointTypes = remote.get(modelId)?.endpointTypes
        if (!endpointTypes?.length || isEqual(model.endpointTypes, endpointTypes)) return []
        return [{ providerId: provider.id, modelId, patch: { endpointTypes } }]
      })
      if (updates.length === 0) return

      modelService.bulkUpdate(updates)
      notifyDataApiDataChange([{ endpoint: '/models', kind: 'projection' }, { endpoint: '/models/:uniqueModelId*' }])
      logger.info('Refreshed CherryIN model endpoints', { count: updates.length })
    } catch (error) {
      if (!this.stopped)
        logger.warn('CherryIN model endpoint refresh failed', {
          errorType: error instanceof Error ? error.name : typeof error
        })
    } finally {
      this.controller = null
    }
  }

  private getEnabledProvider() {
    return providerService
      .list({ enabled: true })
      .find((provider) => provider.id === SystemProviderIds.cherryin && provider.apiKeys.some((key) => key.isEnabled))
  }
}
