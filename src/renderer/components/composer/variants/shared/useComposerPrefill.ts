import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { popup } from '@renderer/services/popup'

import { useComposerLayerActive } from '../../ComposerContext'
import type { ComposerSurfaceActions } from '../../ComposerSurfaceRuntime'

type PrefillActions = Pick<ComposerSurfaceActions, 'getDraft' | 'replaceDraft' | 'focus'>

/**
 * Puts `text` into the composer of the conversation `topicId` (an Assistant topic id, or an Agent
 * session's topic id). A non-empty draft is replaced only after the user confirms.
 */
export function requestComposerPrefill(topicId: string, text: string) {
  void EventEmitter.emit(EVENT_NAMES.PREFILL_COMPOSER, { topicId, text })
}

/**
 * Applies {@link requestComposerPrefill} requests addressed to this composer. `EventEmitter` is
 * window-wide, so the payload's `topicId` must match — otherwise every mounted composer would take it.
 */
export function useComposerPrefill<T extends PrefillActions>(actionsRef: RefObject<T>, topicId: string): void {
  const { t } = useTranslation()
  const layerActive = useComposerLayerActive()

  const prefill = useEffectEvent(async (text: string) => {
    const draft = actionsRef.current.getDraft()
    const focusComposer = () => actionsRef.current.focus('end')
    if (draft.text.trim() || draft.tokens.length > 0) {
      const confirmed = await popup.confirm({
        title: t('chat.input.prefill.replace_title'),
        content: t('chat.input.prefill.replace_content'),
        okText: t('chat.input.prefill.replace'),
        focusOnClose: focusComposer
      })
      if (!confirmed) return
    }
    actionsRef.current.replaceDraft({ text, tokens: [] })
    focusComposer()
  })

  useEffect(() => {
    if (!layerActive) return
    return EventEmitter.on(EVENT_NAMES.PREFILL_COMPOSER, (payload) => {
      const request = payload as { topicId?: string; text?: string } | undefined
      if (typeof request?.text !== 'string' || request.topicId !== topicId) return
      void prefill(request.text)
    })
  }, [layerActive, topicId])
}
