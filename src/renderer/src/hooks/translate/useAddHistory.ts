import { useMutation } from '@data/hooks/useDataApi'
import type { CreateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to create a new translate history record.
 *
 * Sends a `POST /translate/histories` request
 * and refreshes the history list on success.
 *
 * @returns A stable callback `(data: CreateTranslateHistoryDto) => Promise<TranslateHistory>`
 */
export const useAddHistory = () => {
  const { trigger } = useMutation('POST', '/translate/histories', {
    refresh: ['/translate/histories']
  })

  return useCallback((data: CreateTranslateHistoryDto) => trigger({ body: data }), [trigger])
}
