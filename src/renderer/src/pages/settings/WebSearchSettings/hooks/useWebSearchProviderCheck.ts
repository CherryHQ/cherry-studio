import { loggerService } from '@logger'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWebSearchProviderCheck')

const WEB_SEARCH_CHECK_KEYWORD = 'Cherry Studio'
const WEB_SEARCH_CHECK_URL = 'https://example.com'

type UseWebSearchProviderCheckOptions = {
  provider: WebSearchProvider
  capability: WebSearchCapability
  commitForm: () => Promise<void>
}

export function useWebSearchProviderCheck({ provider, capability, commitForm }: UseWebSearchProviderCheckOptions) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const canCheck = provider.id !== 'fetch'

  const checkProvider = useCallback(() => {
    if (checking || !canCheck) {
      return Promise.resolve()
    }

    setChecking(true)

    const runCheck = async () => {
      await commitForm()

      if (capability === 'fetchUrls') {
        await window.api.webSearch.fetchUrls({ providerId: provider.id, urls: [WEB_SEARCH_CHECK_URL] })
      } else {
        await window.api.webSearch.searchKeywords({ providerId: provider.id, keywords: [WEB_SEARCH_CHECK_KEYWORD] })
      }
    }

    return runCheck().then(
      () => {
        setChecking(false)
        window.toast.success(t('settings.tool.websearch.check_success'))
      },
      (error) => {
        setChecking(false)
        logger.error('Web search provider check failed', error as Error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        window.toast.error(`${t('settings.tool.websearch.check_failed')}: ${errorMessage}`)
      }
    )
  }, [canCheck, capability, checking, commitForm, provider.id, t])

  return {
    checking,
    canCheck,
    checkProvider
  }
}
