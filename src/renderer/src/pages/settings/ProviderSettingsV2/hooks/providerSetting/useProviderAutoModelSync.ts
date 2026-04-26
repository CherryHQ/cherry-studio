import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettingsV2/utils/providerTopology'
import { useEffect, useMemo, useRef } from 'react'

import { useProviderModelSync } from '../useProviderModelSync'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { getModelSyncSignature } from './getModelSyncSignature'

const logger = loggerService.withContext('ProviderSettings:AutoModelSync')

/**
 * This is a coordination effect hook, not a domain-cohesive state hook.
 * Boundary rule: it may read across provider, api key, and model domains internally,
 * but callers must not assemble provider, models, api keys, sync handlers, or loading flags for it
 * when the hook can resolve those dependencies itself.
 * Target external API is useProviderAutoModelSync(providerId).
 * Do not treat a wider parameter surface as acceptable precedent, and do not extend this hook into a facade/view-model.
 * It must own exactly one cross-domain side effect and return no wide object.
 *
 * Intent: trigger the one-time automatic model sync when a provider becomes configured enough and has no local models.
 * Scope: use once in the Provider Settings page where page-level synchronization is coordinated.
 * Does not handle: manual refreshes, endpoint commit sync, or any model list UI.
 */
export function useProviderAutoModelSync(providerId: string) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { syncProviderModels, isSyncingModels } = useProviderModelSync(providerId, { existingModels: models })

  const initialModelSyncSignatureRef = useRef<string | null>(null)
  const lastAutoSyncLogKeyRef = useRef<string | null>(null)
  const topology = getProviderHostTopology(provider)

  const requiresApiKeyForModelSync = useMemo(() => {
    if (!provider) {
      return true
    }

    return !(
      provider.id === 'ollama' ||
      provider.id === 'lmstudio' ||
      provider.id === 'copilot' ||
      provider.authType === 'iam-gcp' ||
      provider.authType === 'iam-aws'
    )
  }, [provider])

  const initialModelSyncSignature = useMemo(() => {
    if (!provider) {
      return null
    }

    return getModelSyncSignature(provider, apiKeysData)
  }, [apiKeysData, provider])

  const autoSyncDecision = useMemo(() => {
    if (!provider) {
      return {
        shouldSync: false,
        reason: 'no_provider'
      } as const
    }

    if (models.length > 0) {
      return {
        shouldSync: false,
        reason: 'existing_models',
        details: { modelCount: models.length }
      } as const
    }

    if (!topology.primaryBaseUrl.trim().length && provider.id !== 'vertexai') {
      return {
        shouldSync: false,
        reason: 'missing_primary_base_url'
      } as const
    }

    if (requiresApiKeyForModelSync && (apiKeysData?.keys?.length ?? 0) === 0) {
      return {
        shouldSync: false,
        reason: 'no_api_keys'
      } as const
    }

    if (!initialModelSyncSignature) {
      return {
        shouldSync: false,
        reason: 'missing_sync_signature'
      } as const
    }

    if (isSyncingModels) {
      return {
        shouldSync: false,
        reason: 'sync_in_progress'
      } as const
    }

    if (initialModelSyncSignatureRef.current === initialModelSyncSignature) {
      return {
        shouldSync: false,
        reason: 'already_synced_for_signature',
        details: { signature: initialModelSyncSignature }
      } as const
    }

    return {
      shouldSync: true,
      reason: 'ready',
      details: { signature: initialModelSyncSignature }
    } as const
  }, [
    apiKeysData?.keys?.length,
    initialModelSyncSignature,
    isSyncingModels,
    models.length,
    provider,
    requiresApiKeyForModelSync,
    topology.primaryBaseUrl
  ])

  useEffect(() => {
    if (!provider) {
      return
    }

    const logKey = `${provider.id}:${autoSyncDecision.reason}:${autoSyncDecision.details ? JSON.stringify(autoSyncDecision.details) : ''}`
    if (lastAutoSyncLogKeyRef.current !== logKey) {
      lastAutoSyncLogKeyRef.current = logKey

      if (autoSyncDecision.shouldSync) {
        logger.info('Starting provider auto model sync', {
          providerId,
          reason: autoSyncDecision.reason,
          ...autoSyncDecision.details
        })
      } else {
        logger.info('Skipping provider auto model sync', {
          providerId,
          reason: autoSyncDecision.reason,
          ...autoSyncDecision.details
        })
      }
    }

    if (!autoSyncDecision.shouldSync) {
      return
    }

    initialModelSyncSignatureRef.current = initialModelSyncSignature
    void syncProviderModels(provider)
  }, [autoSyncDecision, initialModelSyncSignature, provider, providerId, syncProviderModels])
}
