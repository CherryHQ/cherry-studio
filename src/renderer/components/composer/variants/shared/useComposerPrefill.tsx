import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '@cherrystudio/ui'
import { cacheService } from '@renderer/data/CacheService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { popup } from '@renderer/services/popup'

import { useComposerLayerActive } from '../../ComposerContext'
import type { ComposerSurfaceActions } from '../../ComposerSurfaceRuntime'

type PrefillActions = Pick<ComposerSurfaceActions, 'getDraft' | 'replaceDraft' | 'focus'>

/**
 * Puts `text` into the composer of the conversation `topicId` (an Assistant topic id, or an Agent
 * session's topic id). A non-empty draft is replaced only after the user confirms, unless they chose
 * not to be asked again.
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
  const dontAskId = useId()

  const prefill = useEffectEvent(async (text: string) => {
    const draft = actionsRef.current.getDraft()
    const focusComposer = () => actionsRef.current.focus('end')
    const hasDraft = draft.text.trim() || draft.tokens.length > 0
    if (hasDraft && !cacheService.getPersist('ui.composer.prefill_confirm_hidden')) {
      let hideNextTime = false
      const confirmed = await popup.confirm({
        title: t('chat.input.prefill.replace_title'),
        content: (
          <div className="flex flex-col gap-3">
            <span>{t('chat.input.prefill.replace_content')}</span>
            <div className="flex items-center gap-2">
              <Checkbox id={dontAskId} size="sm" onCheckedChange={(checked) => (hideNextTime = checked === true)} />
              <label htmlFor={dontAskId} className="cursor-pointer text-foreground text-sm leading-none">
                {t('chat.input.prefill.dont_ask_again')}
              </label>
            </div>
          </div>
        ),
        okText: t('chat.input.prefill.replace'),
        focusOnClose: focusComposer
      })
      if (!confirmed) return
      // Only a confirmed replace remembers the choice; cancelling keeps asking.
      if (hideNextTime) cacheService.setPersist('ui.composer.prefill_confirm_hidden', true)
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
