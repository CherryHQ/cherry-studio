import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import { formatQuoteTokenPromptText } from '@renderer/components/composer/quoteToken'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { IpcChannel } from '@shared/IpcChannel'

import { useComposerLayerActive } from '../../ComposerContext'
import type { ComposerDraftToken } from '../../tokens'

export const createQuoteToken = (
  selectedText: string,
  label: string,
  sourceMessageId?: string
): ComposerDraftToken & { kind: 'quote'; promptText: string; description: string } => ({
  ...(sourceMessageId && { sourceMessageId }),
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

type QuoteInsertionActions = Pick<ComposerSurfaceActions, 'focus' | 'getDraft' | 'insertToken' | 'replaceDraft'>

/**
 * Inserts external quotes and selections addressed to this active composer.
 */
export function useComposerQuoteInsertion<T extends QuoteInsertionActions>(
  actionsRef: RefObject<T>,
  topicId?: string
): void {
  const { t } = useTranslation()
  const layerActive = useComposerLayerActive()

  const insertQuote = useEffectEvent((selectedText: string, sourceMessageId?: string, replyText?: string) => {
    if (!selectedText) return
    const token = createQuoteToken(selectedText, t('selection.action.builtin.quote'), sourceMessageId)
    const actions = actionsRef.current
    if (!replyText) {
      actions.insertToken(token)
      return
    }

    const draft = actions.getDraft()
    const prefix = draft.text ? draft.text + '\n\n' : ''
    actions.replaceDraft(
      {
        text: `${prefix}${token.promptText}\n${replyText}`,
        tokens: [...draft.tokens, { ...token, index: draft.tokens.length, textOffset: prefix.length }]
      },
      { emitUpdate: true }
    )
    actions.focus('end')
  })

  useEffect(() => {
    if (!layerActive) return
    const offIpc = window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) => {
      insertQuote(selectedText)
    })
    const offSelection = EventEmitter.on(EVENT_NAMES.INSERT_COMPOSER_QUOTE, (payload) => {
      if (!topicId || !payload || typeof payload !== 'object') return
      if (!('topicId' in payload) || payload.topicId !== topicId) return
      if (!('text' in payload) || typeof payload.text !== 'string') return
      const sourceMessageId =
        'sourceMessageId' in payload && typeof payload.sourceMessageId === 'string'
          ? payload.sourceMessageId
          : undefined
      const replyText = 'replyText' in payload && typeof payload.replyText === 'string' ? payload.replyText : undefined
      insertQuote(payload.text, sourceMessageId, replyText)
    })
    return () => {
      offIpc?.()
      offSelection()
    }
  }, [layerActive, topicId])
}
