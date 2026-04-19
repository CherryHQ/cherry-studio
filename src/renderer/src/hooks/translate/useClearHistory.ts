import { useMutation } from '@data/hooks/useDataApi'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to clear all translate history entries.
 *
 * Sends a `DELETE /translate/histories` request
 * and refreshes the history list on success.
 *
 * @returns A stable callback `() => Promise<void>`
 */
export const useClearHistory = () => {
  const { trigger } = useMutation('DELETE', '/translate/histories', {
    refresh: ['/translate/histories']
  })

  return useCallback(() => trigger(), [trigger])
}
