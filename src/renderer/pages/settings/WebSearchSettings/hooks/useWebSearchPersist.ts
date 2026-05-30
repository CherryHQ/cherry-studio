import { loggerService } from '@logger'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebSearchSettings')

export type WebSearchPersistResult<T> = { ok: true; value: T } | { ok: false }

export function useWebSearchPersist() {
  const { t } = useTranslation()

  return useCallback(
    async <T>(action: () => Promise<T>, message: string): Promise<WebSearchPersistResult<T>> => {
      try {
        return { ok: true, value: await action() }
      } catch (error) {
        logger.error(message, error as Error)
        window.toast.error(t('settings.tool.websearch.errors.save_failed'))
        return { ok: false }
      }
    },
    [t]
  )
}
