import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'

import { fetchResolvedProviderModels } from './modelSync'
import type { ModelSyncPreviewMissingItem, ModelSyncPreviewResponse } from './modelSyncPreviewTypes'

const logger = loggerService.withContext('ModelListSyncPreview')

/**
 * Build pull preview: remote model list (resolved via IPC) vs local DataApi
 * state. Apply uses `POST /models` and `DELETE /models/:uniqueModelId` with
 * the preview selection (no extra apply route).
 */
export async function buildModelListSyncPreview(params: { providerId: string }): Promise<ModelSyncPreviewResponse> {
  const { providerId } = params

  const [localModels, remoteModels] = await Promise.all([
    dataApiService.get('/models' as const, { query: { providerId } }),
    fetchResolvedProviderModels(providerId)
  ])

  const localIds = new Set(localModels.map((m) => m.id))
  const remoteIds = new Set(remoteModels.map((m) => m.id))

  const added = remoteModels.filter((m) => !localIds.has(m.id))
  /** Purely user-defined rows (no preset trace) are out of upstream removal diff. */
  const missingModels = localModels.filter((m) => {
    if (remoteIds.has(m.id)) {
      return false
    }
    if (m.presetModelId == null || m.presetModelId === '') {
      return false
    }
    return true
  })

  const missing: ModelSyncPreviewMissingItem[] = missingModels.map((model) => ({
    model,
    removalReason: 'missing_from_provider'
  }))

  logger.info('Built model list sync preview (renderer)', {
    providerId,
    addedCount: added.length,
    missingCount: missing.length
  })

  return {
    added,
    missing
  }
}
