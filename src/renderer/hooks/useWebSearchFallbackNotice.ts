import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { WEB_SEARCH_PROVIDER_PRESET_MAP } from '@shared/data/presets/webSearchProviders'

export function useWebSearchFallbackNotice(): void {
  const { t } = useTranslation()
  const notices = useRef(new Map<string, number>())

  useEffect(() => {
    const seen = notices.current
    return () => seen.clear()
  }, [])

  useIpcOn('web_search.fallback', ({ primaryProviderId, fallbackProviderId, capability }) => {
    const now = Date.now()
    const key = JSON.stringify([primaryProviderId, fallbackProviderId, capability])
    const previous = notices.current.get(key)
    if (previous !== undefined && now - previous < 10_000) return
    notices.current.set(key, now)
    toast.warning({
      description: t('message.websearch.provider_fallback', {
        provider: WEB_SEARCH_PROVIDER_PRESET_MAP[primaryProviderId]?.name ?? primaryProviderId,
        fallbackProvider: WEB_SEARCH_PROVIDER_PRESET_MAP[fallbackProviderId]?.name ?? fallbackProviderId
      }),
      timeout: 8000
    })
  })
}
