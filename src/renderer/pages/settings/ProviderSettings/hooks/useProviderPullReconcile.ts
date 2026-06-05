import { loggerService } from '@logger'
import { useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildModelListSyncPreview } from '../ModelList/buildModelListSyncPreview'
import { ModelSyncError } from '../ModelList/modelSync'
import type { ModelSyncPreviewResponse } from '../ModelList/modelSyncPreviewTypes'

const logger = loggerService.withContext('ProviderPullReconcile')

/**
 * Pull reconcile preview: remote vs local diff until the user applies or dismisses.
 */
export function useProviderPullReconcile(providerId: string) {
  const { t } = useTranslation()
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const [preview, setPreview] = useState<ModelSyncPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

  // The provider object omits the secret `key` (RuntimeApiKeySchema strips
  // it), so the concrete-key fingerprint must come from the api-keys
  // endpoint — same source the auto-pull trigger uses.
  const enabledKeySignature = useMemo(
    () =>
      (apiKeysData?.keys ?? [])
        .filter((key) => key.isEnabled)
        .map((key) => key.key)
        .sort()
        .join('|'),
    [apiKeysData]
  )

  // Single-flight is keyed by the concrete enabled-key fingerprint: rapid
  // blur/paste of the *same* key dedupes onto one upstream call, but a key
  // change starts a fresh fetch instead of returning the stale promise. A
  // monotonic sequence guard ensures a superseded fetch never overwrites the
  // preview produced for the newer key.
  const inflightRef = useRef<{ signature: string; promise: Promise<ModelSyncPreviewResponse | null> } | null>(null)
  const seqRef = useRef(0)

  const reset = useCallback(() => {
    setPreview(null)
  }, [])

  const fetchPreview = useCallback(async (): Promise<ModelSyncPreviewResponse | null> => {
    const signature = enabledKeySignature
    const inflight = inflightRef.current
    if (inflight && inflight.signature === signature) {
      return inflight.promise
    }
    const seq = ++seqRef.current
    const isCurrent = () => seqRef.current === seq
    setIsPreviewLoading(true)
    const promise = (async () => {
      try {
        const next = await buildModelListSyncPreview({ providerId })
        if (isCurrent()) setPreview(next)
        return next
      } catch (error) {
        logger.error('Pull reconcile preview failed', { providerId, error })
        if (isCurrent()) {
          setPreview(null)
          if (error instanceof ModelSyncError && error.code === 'NO_ENABLED_API_KEY') {
            window.toast.error(t('settings.models.check.no_api_keys'))
          } else {
            window.toast.error(t('settings.models.manage.sync_pull_failed'))
          }
        }
        throw error instanceof Error ? error : new Error(String(error))
      } finally {
        if (isCurrent()) {
          setIsPreviewLoading(false)
          inflightRef.current = null
        }
      }
    })()
    inflightRef.current = { signature, promise }
    return promise
  }, [providerId, t, enabledKeySignature])

  return {
    preview,
    isPreviewLoading,
    fetchPreview,
    reset
  }
}
