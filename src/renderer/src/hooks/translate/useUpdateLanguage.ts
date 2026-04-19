import { useMutation } from '@data/hooks/useDataApi'
import type { UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to update a translate language.
 *
 * Sends a `PATCH /translate/languages/:langCode` request with optimistic update
 * and refreshes the language list on success.
 *
 * @param langCode - The language code to update
 * @param currentData - Current language data, used as the base for optimistic update
 * @returns A stable callback `(data: UpdateTranslateLanguageDto) => Promise<TranslateLanguage>`
 */
export const useUpdateLanguage = (langCode: string, currentData?: { value: string; emoji: string }) => {
  const { trigger } = useMutation('PATCH', `/translate/languages/${langCode}`, {
    refresh: ['/translate/languages'],
    optimisticData: currentData ? { langCode, ...currentData, createdAt: '', updatedAt: '' } : undefined
  })

  return useCallback((data: UpdateTranslateLanguageDto) => trigger({ body: data }), [trigger])
}
