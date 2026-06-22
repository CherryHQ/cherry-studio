import { formatQuoteTokenPromptText } from '@renderer/components/chat/utils/quoteToken'
import { IpcChannel } from '@shared/IpcChannel'
import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerDraftToken } from '../../tokens'

export const createQuoteToken = (selectedText: string, label: string): ComposerDraftToken => ({
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

interface QuoteInsertionActions {
  insertToken: (token: ComposerDraftToken) => void
  toggleExpanded: (nextState?: boolean) => void
}

/**
 * Subscribes to the main-process quote IPC and inserts the quoted text as a quote token via
 * the composer's imperative actions ref. The insertion runs through `useEffectEvent` so the
 * IPC listener subscribes once and stays stable across renders.
 */
export function useComposerQuoteInsertion<T extends QuoteInsertionActions>(actionsRef: RefObject<T>): void {
  const { t } = useTranslation()

  const insertQuote = useEffectEvent((selectedText: string) => {
    if (!selectedText) return
    actionsRef.current.insertToken(createQuoteToken(selectedText, t('selection.action.builtin.quote')))
    // Reveal the composer so the freshly inserted quote is visible even when collapsed.
    actionsRef.current.toggleExpanded(true)
  })

  useEffect(() => {
    return window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) => {
      insertQuote(selectedText)
    })
  }, [insertQuote])
}
