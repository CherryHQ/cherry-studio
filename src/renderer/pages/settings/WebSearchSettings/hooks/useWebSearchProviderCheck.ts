import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { webSearchErrorCodes } from '@shared/ipc/errors/webSearch'

const logger = loggerService.withContext('useWebSearchProviderCheck')

const WEB_SEARCH_CHECK_KEYWORD = 'Cherry Studio'
const WEB_SEARCH_CHECK_URL = 'https://example.com'
const QUERIT_FETCH_CHECK_URL = 'https://www.querit.ai/en/docs/overview/about'

type UseWebSearchProviderCheckOptions = {
  provider: WebSearchProvider
  capability: WebSearchCapability
}

export function useWebSearchProviderCheck({ provider, capability }: UseWebSearchProviderCheckOptions) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const canCheck = provider.id !== 'fetch'

  const checkProvider = useCallback(() => {
    if (checking || !canCheck) {
      return Promise.resolve()
    }

    setChecking(true)

    const probeUrl =
      provider.id === 'querit' && capability === 'fetchUrls' ? QUERIT_FETCH_CHECK_URL : WEB_SEARCH_CHECK_URL
    const runCheck = async () => {
      if (capability === 'fetchUrls') {
        await ipcApi.request('web_search.fetch_urls', { providerId: provider.id, urls: [probeUrl] })
      } else {
        await ipcApi.request('web_search.search_keywords', {
          providerId: provider.id,
          keywords: [WEB_SEARCH_CHECK_KEYWORD]
        })
      }
    }

    return runCheck().then(
      () => {
        setChecking(false)
        toast.success(t('settings.tool.websearch.check_success'))
      },
      (error) => {
        setChecking(false)
        logger.error('Web search provider check failed', error as Error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (error instanceof IpcError && error.code === webSearchErrorCodes.WEB_SEARCH_PAGE_FETCH_FAILED) {
          toast.error({
            title: t('settings.tool.websearch.check_failed'),
            description: t('settings.tool.websearch.check_page_fetch_failed', { url: probeUrl })
          })
        } else {
          toast.error(`${t('settings.tool.websearch.check_failed')}: ${errorMessage}`)
        }
      }
    )
  }, [canCheck, capability, checking, provider.id, t])

  return {
    checking,
    canCheck,
    checkProvider
  }
}
