import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'

interface ComposerFillActions {
  focus: (position?: 'start' | 'end' | 'all' | number | boolean | null) => void
  getDraft: () => { text: string }
}

/**
 * Fills the matching composer from FILL_CHAT_COMPOSER. Non-empty draft text is left
 * untouched so a greeting-chip click cannot replace a prompt the user already typed.
 */
export function useComposerFill<T extends ComposerFillActions>(
  actionsRef: RefObject<T>,
  topicId: string,
  apply: (text: string) => void
): void {
  const fill = useEffectEvent((text: string) => {
    if (actionsRef.current.getDraft().text.trim() !== '') return
    apply(text)
    window.requestAnimationFrame(() => actionsRef.current.focus('end'))
  })

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.FILL_CHAT_COMPOSER, (payload) => {
      const input =
        typeof payload === 'object' && payload ? (payload as { topicId?: string; text?: string }) : undefined
      if (input?.topicId !== topicId || !input.text) return
      fill(input.text)
    })
  }, [fill, topicId])
}
