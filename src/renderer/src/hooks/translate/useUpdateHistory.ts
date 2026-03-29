import { useMutation } from '@data/hooks/useDataApi'
import type { UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to update a translate history entry with optimistic update.
 *
 * Sends a `PATCH /translate/histories/:id` request
 * and refreshes the history list on success.
 *
 * @param id - The ID of the translate history to update
 * @returns A stable callback `(data: UpdateTranslateHistoryDto) => Promise<TranslateHistory>`
 */
export const useUpdateHistory = (id: string) => {
  const { trigger } = useMutation('PATCH', `/translate/histories/${id}`, {
    refresh: ['/translate/histories']
  })

  return useCallback((data: UpdateTranslateHistoryDto) => trigger({ body: data }), [trigger])
}
