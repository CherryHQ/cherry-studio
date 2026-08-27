import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef } from 'react'

import { hasComposerDraftUserText } from '../../composerDraft'
import type { ComposerSerializedToken } from '../../tokens'

interface ComposerFillActions {
  focus: (position?: 'start' | 'end' | 'all' | number | boolean | null) => void
  getDraft: () => { text: string; tokens?: readonly ComposerSerializedToken[] }
}

/**
 * Fills the matching composer from FILL_CHAT_COMPOSER. User-typed text is left
 * untouched; serialized knowledge/skill promptText is not treated as typed input.
 */
export function useComposerFill<T extends ComposerFillActions>(
  actionsRef: RefObject<T>,
  topicId: string,
  apply: (text: string) => void,
  getFillDraft?: () => { text: string; tokens?: readonly ComposerSerializedToken[] }
): void {
  const focusFrameRef = useRef<number | null>(null)
  const mountedRef = useRef(false)

  const fill = useEffectEvent((text: string) => {
    // Judge the draft apply() would write (parked), not the history overlay.
    const draft = getFillDraft?.() ?? actionsRef.current.getDraft()
    if (hasComposerDraftUserText({ text: draft.text, tokens: draft.tokens ? [...draft.tokens] : [] })) return
    apply(text)
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!mountedRef.current) return
      actionsRef.current.focus('end')
    })
  })

  useEffect(() => {
    mountedRef.current = true
    const off = EventEmitter.on(EVENT_NAMES.FILL_CHAT_COMPOSER, (payload) => {
      const input =
        typeof payload === 'object' && payload ? (payload as { topicId?: string; text?: string }) : undefined
      if (input?.topicId !== topicId || !input.text) return
      fill(input.text)
    })
    return () => {
      mountedRef.current = false
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = null
      }
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fill` is useEffectEvent; resubscribing would cancel a pending focus after apply().
  }, [topicId])
}
