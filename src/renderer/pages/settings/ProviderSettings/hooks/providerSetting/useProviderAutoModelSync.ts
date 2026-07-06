import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { providerNeedsApiKeyForModelSync } from '@renderer/pages/settings/ProviderSettings/ModelList/providerModelSyncRequirements'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { isExternalCliProvider, isLoginBasedProvider } from '@shared/utils/provider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { useEffect, useMemo, useRef } from 'react'

import { useProviderModelSync } from '../useProviderModelSync'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { getModelSyncSignature } from './getModelSyncSignature'

const logger = loggerService.withContext('ProviderSettings:AutoModelSync')

/** Triggers one automatic model sync when a provider becomes configured and has no local models. */
export function useProviderAutoModelSync(providerId: string) {
  const { provider, updateProvider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { syncProviderModels, isSyncingModels } = useProviderModelSync(providerId, { existingModels: [...models] })

  const initialModelSyncSignatureRef = useRef<string | null>(null)
  const lastAutoSyncLogKeyRef = useRef<string | null>(null)
  const topology = getProviderHostTopology(provider)

  const requiresApiKeyForModelSync = useMemo(() => {
    if (!provider) {
      return true
    }

    return providerNeedsApiKeyForModelSync(provider)
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

    // Chat-visible login providers (codex / grok-cli, OAuth) ship disabled and
    // serve a registry catalog, so without this gate visiting their settings
    // page would sync + enable them — surfacing model pickers before the user
    // signs in. Their LoginOauthPanel flips `isEnabled` on confirmed login, so
    // treat `isEnabled` as the "signed in" signal and defer sync until then.
    // External-CLI providers (claude-code) are exempt: agent-only/undeletable
    // and never chat-visible, they must stay enabled with their catalog
    // materialized so agents can pick a model regardless of CLI login state.
    if (isLoginBasedProvider(provider) && !isExternalCliProvider(provider) && !provider.isEnabled) {
      return {
        shouldSync: false,
        reason: 'login_required'
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

    if (requiresApiKeyForModelSync) {
      return {
        shouldSync: false,
        reason: 'uses_pull_reconcile'
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

    // Re-entrancy guard against a double launch within the same render. React
    // StrictMode invokes effects twice in dev, and `autoSyncDecision` is
    // memoized — it does not observe the ref we set below — so both invocations
    // would see `shouldSync: true` and fire two concurrent `/models` mutations
    // on the same SWR hook instance. One then loses the race, SWR discards its
    // (failed) result as `undefined`, and the caller spreads it ("created is not
    // iterable"). The ref is the synchronous source of truth between invocations.
    if (initialModelSyncSignatureRef.current === initialModelSyncSignature) {
      return
    }

    initialModelSyncSignatureRef.current = initialModelSyncSignature
    void syncProviderModels()
      .then(async (syncedModels) => {
        await enableProviderWhenModelsAvailable(provider, updateProvider, syncedModels.length, 'auto_model_sync')
      })
      .catch((error) => {
        logger.error('Provider auto model sync failed', { providerId, error })
        if (initialModelSyncSignatureRef.current === initialModelSyncSignature) {
          initialModelSyncSignatureRef.current = null
        }
      })
  }, [autoSyncDecision, initialModelSyncSignature, provider, providerId, syncProviderModels, updateProvider])
}
