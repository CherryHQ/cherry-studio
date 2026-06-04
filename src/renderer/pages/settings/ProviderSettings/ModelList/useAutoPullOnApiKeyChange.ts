import { useModels } from '@renderer/hooks/useModel'
import { useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useEffect, useMemo, useRef } from 'react'

/**
 * Fires `onTrigger` once whenever the provider's enabled API-key fingerprint
 * changes — but only after the first render and only when local models already
 * exist (first-time bootstrap is owned by `useProviderAutoModelSync`).
 */
export function useAutoPullOnApiKeyChange(providerId: string, onTrigger: () => void | Promise<void>) {
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { models } = useModels({ providerId })

  const enabledKeySignature = useMemo(
    () =>
      (apiKeysData?.keys ?? [])
        .filter((key) => key.isEnabled)
        .map((key) => key.key)
        .sort()
        .join('|'),
    [apiKeysData]
  )

  const lastSignatureRef = useRef<string | null>(null)
  const onTriggerRef = useRef(onTrigger)

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    // Until api-keys resolve, the signature is the cold-cache empty string ('');
    // recording that as the baseline would make the later undefined→keys
    // transition look like a user-initiated key change and auto-fire the pull.
    if (apiKeysData === undefined) return
    if (lastSignatureRef.current === null) {
      lastSignatureRef.current = enabledKeySignature
      return
    }
    if (lastSignatureRef.current === enabledKeySignature) {
      return
    }
    lastSignatureRef.current = enabledKeySignature
    if (!enabledKeySignature) return
    if (models.length === 0) return
    void onTriggerRef.current()
  }, [apiKeysData, enabledKeySignature, models.length])
}
