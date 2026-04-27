import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { fetchResolvedProviderModels } from './modelSync'
import type { ModelSyncPreviewMissingItem, ModelSyncPreviewResponse } from './modelSyncPreviewTypes'

const logger = loggerService.withContext('ModelListSyncPreview')

/**
 * Build pull preview: same remote resolution as first API key (see `fetchResolvedProviderModels`).
 * Reference impact is not loaded here; apply (`ModelSyncService.apply`) re-checks before delete.
 */
export async function buildModelListSyncPreview(params: {
  providerId: string
  provider: Provider
}): Promise<ModelSyncPreviewResponse> {
  const { providerId, provider } = params

  const [localModels, remoteModels] = await Promise.all([
    dataApiService.get('/models' as const, { query: { providerId } }) as Promise<Model[]>,
    fetchResolvedProviderModels(providerId, provider)
  ])

  const localIds = new Set(localModels.map((m) => m.id))
  const remoteIds = new Set(remoteModels.map((m) => m.id))

  const added = remoteModels.filter((m) => !localIds.has(m.id))
  const missingModels = localModels.filter((m) => !remoteIds.has(m.id))

  const missing: ModelSyncPreviewMissingItem[] = missingModels.map((model) => ({
    model,
    canDelete: true,
    defaultAction: 'deprecated',
    assistantCount: 0,
    knowledgeCount: 0,
    preferenceReferences: [],
    strongReferenceCount: 0,
    replacement: undefined
  }))

  logger.info('Built model list sync preview (renderer)', {
    providerId,
    addedCount: added.length,
    missingCount: missing.length
  })

  return {
    added,
    missing,
    referenceSummary: {
      impactedModelCount: 0,
      totalStrongReferences: 0,
      items: []
    },
    replacementSuggestions: []
  }
}
