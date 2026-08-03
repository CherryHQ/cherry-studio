import { formatQuoteTokenPromptText } from '@renderer/components/composer/quoteToken'
import type { SelectionQuoteRequest } from '@renderer/types/selectionQuote'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerDraftToken, ComposerSerializedDraft } from '../../tokens'

export const createQuoteToken = (selectedText: string, label: string): ComposerDraftToken => ({
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

interface QuoteInsertionActions {
  getDraft: () => ComposerSerializedDraft
  insertToken: (token: ComposerDraftToken) => boolean
}

/**
 * Inserts a selection quote routed to this composer by the owning chat page.
 */
export function useComposerQuoteInsertion<T extends QuoteInsertionActions>(
  actionsRef: RefObject<T>,
  request?: SelectionQuoteRequest,
  onDraftChange?: (draft: ComposerSerializedDraft) => void,
  onInserted?: () => void
): () => void {
  const { t } = useTranslation()
  const insertedRequestIdRef = useRef<string | undefined>(undefined)

  const insertPendingQuote = useCallback(() => {
    if (!request || insertedRequestIdRef.current === request.id) return
    const token = createQuoteToken(request.text, t('selection.action.builtin.quote'))
    if (!actionsRef.current.insertToken(token)) return

    insertedRequestIdRef.current = request.id
    onDraftChange?.(actionsRef.current.getDraft())
    onInserted?.()
  }, [actionsRef, onDraftChange, onInserted, request, t])

  useEffect(() => insertPendingQuote(), [insertPendingQuote])

  return insertPendingQuote
}
