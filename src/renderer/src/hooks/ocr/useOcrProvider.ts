import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { OcrProviderConfig } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import type { ConcreteApiPaths } from '@shared/data/api'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('useOcrProvider')

export const useOcrProvider = (id: string | null) => {
  const { t } = useTranslation()

  const path: ConcreteApiPaths = `/ocr/providers/${id}`
  const { data, loading, error } = useQuery(path)
  const { mutate, loading: mutating } = useMutation('PATCH', path)

  const updateConfig = useCallback(
    async (update: Partial<OcrProviderConfig>) => {
      if (!id) return
      try {
        await mutate({ body: { id, config: update } })
      } catch (e) {
        window.toast.error({ title: t('ocr.provider.config.patch.error.failed'), description: getErrorMessage(e) })
      }
    },
    [id, mutate, t]
  )

  return {
    /** undefined: loading; null: invalid, id is null */
    provider: id ? data?.data : null,
    loading,
    mutating,
    error,
    updateConfig
  }
}
