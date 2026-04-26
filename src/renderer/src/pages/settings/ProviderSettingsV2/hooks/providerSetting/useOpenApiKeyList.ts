import { useProvider } from '@renderer/hooks/useProviders'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderMeta } from './useProviderMeta'

/**
 * Intent: open the provider API key management popup after flushing the current inline input.
 * Scope: use in Provider Settings UI flows that need to jump from inline auth editing to the full key list.
 * Does not handle: connection checks or ownership of the API key field.
 */
export function useOpenApiKeyList(providerId: string) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { commitInputApiKeyNow } = useAuthenticationApiKey()
  const [apiKeyListOpen, setApiKeyListOpen] = useState(false)

  const title = useMemo(
    () => `${meta.fancyProviderName} ${t('settings.provider.api.key.list.title')}`,
    [meta.fancyProviderName, t]
  )

  const openApiKeyList = useCallback(async () => {
    if (!provider) {
      return
    }

    await commitInputApiKeyNow()
    setApiKeyListOpen(true)
  }, [commitInputApiKeyNow, provider])

  const closeApiKeyList = useCallback(() => {
    setApiKeyListOpen(false)
  }, [])

  return {
    apiKeyListOpen,
    openApiKeyList,
    closeApiKeyList,
    title
  }
}
