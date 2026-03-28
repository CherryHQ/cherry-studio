import { useMutation } from '@data/hooks/useDataApi'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to delete a translate language.
 *
 * Sends a `DELETE /translate/languages/:langCode` request
 * and refreshes the language list on success.
 *
 * @param langCode - The language code to delete
 * @returns A stable callback `() => Promise<void>`
 */
export const useDeleteLanguage = (langCode: string) => {
  const { trigger } = useMutation('DELETE', `/translate/languages/${langCode}`, {
    refresh: ['/translate/languages']
  })

  return useCallback(() => trigger(), [trigger])
}
