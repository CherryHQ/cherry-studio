import { useMutation } from '@data/hooks/useDataApi'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to delete a translate history entry.
 *
 * Sends a `DELETE /translate/histories/:id` request
 * and refreshes the history list on success.
 *
 * @param id - The ID of the translate history to delete
 * @returns A stable callback `() => Promise<void>`
 */
export const useDeleteHistory = (id: string) => {
  const { trigger } = useMutation('DELETE', `/translate/histories/${id}`, {
    refresh: ['/translate/histories']
  })

  return useCallback(() => trigger(), [trigger])
}
