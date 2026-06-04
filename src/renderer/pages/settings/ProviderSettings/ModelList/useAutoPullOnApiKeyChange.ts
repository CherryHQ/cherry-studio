import { useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { useEffect, useMemo, useRef } from 'react'

import { providerNeedsApiKeyForModelSync } from './providerModelSyncRequirements'

/**
 * Fires `onTrigger` once whenever the provider's enabled API-key fingerprint OR
 * its host (endpoint/baseUrl/authType) changes — but only after the first render
 * and only when local models already exist (first-time bootstrap is owned by
 * `useProviderAutoModelSync`). A pull still requires at least one enabled key
 * for providers whose model sync needs API-key auth, so disabling the only key
 * never fires for those providers.
 */
export function useAutoPullOnApiKeyChange(providerId: string, onTrigger: () => void | Promise<void>) {
  const { provider } = useProvider(providerId)
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

  const hostSignature = useMemo(() => {
    if (!provider) return ''
    const topology = getProviderHostTopology(provider)
    return [topology.primaryEndpoint, topology.primaryBaseUrl, topology.anthropicBaseUrl, provider.authType ?? ''].join(
      '|'
    )
  }, [provider])

  const changeSignature = `${hostSignature}::${enabledKeySignature}`
  const requiresApiKeyForModelSync = provider ? providerNeedsApiKeyForModelSync(provider) : true

  const lastSignatureRef = useRef<string | null>(null)
  const onTriggerRef = useRef(onTrigger)

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    // Until provider/api-keys resolve the signature is a cold-cache placeholder;
    // recording that as the baseline would make the later undefined→loaded
    // transition look like a user-initiated change and auto-fire the pull.
    if (!provider || apiKeysData === undefined) return
    if (lastSignatureRef.current === null) {
      lastSignatureRef.current = changeSignature
      return
    }
    if (lastSignatureRef.current === changeSignature) {
      return
    }
    lastSignatureRef.current = changeSignature
    // Key-required providers still need an enabled key; disabling the only key must not fire.
    if (requiresApiKeyForModelSync && !enabledKeySignature) return
    if (models.length === 0) return
    void onTriggerRef.current()
  }, [apiKeysData, changeSignature, enabledKeySignature, models.length, provider, requiresApiKeyForModelSync])
}
