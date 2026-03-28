import { useMutation } from '@data/hooks/useDataApi'
import type { CreateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { useCallback } from 'react'

/**
 * Hook that returns a callback to create a new translate language.
 *
 * Sends a `POST /translate/languages` request and refreshes the language list on success.
 *
 * @returns A stable callback `(data: CreateTranslateLanguageDto) => Promise<TranslateLanguage>`
 */
export const useAddLanguage = () => {
  const { trigger } = useMutation('POST', '/translate/languages', {
    refresh: ['/translate/languages']
  })

  return useCallback((data: CreateTranslateLanguageDto) => trigger({ body: data }), [trigger])
}
