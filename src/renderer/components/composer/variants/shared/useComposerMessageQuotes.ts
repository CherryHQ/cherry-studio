import type { RefObject } from 'react'
import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { MessageQuote } from '@shared/data/types/message'

import { useComposerLayerActive } from '../../ComposerContext'
import type { ComposerSurfaceActions } from '../../ComposerSurface'

export function useComposerMessageQuotes(
  topicId: string | undefined,
  initialQuotes: MessageQuote[] | undefined,
  actionsRef: RefObject<Pick<ComposerSurfaceActions, 'getDraft' | 'focus'>>,
  onInsert: (text: string) => boolean
) {
  const [quotes, setQuotes] = useState<MessageQuote[]>(() => initialQuotes ?? [])
  const active = useComposerLayerActive()
  const insert = useEffectEvent((quote: MessageQuote) => {
    const draft = actionsRef.current.getDraft()
    if (onInsert(draft.text) === false) return
    setQuotes((current) => [...current, quote])
    actionsRef.current.focus('end')
  })

  useEffect(() => {
    if (!active || !topicId) return
    return EventEmitter.on(EVENT_NAMES.INSERT_MESSAGE_QUOTE, (payload) => {
      const request = payload as { topicId: string; quote: MessageQuote }
      if (request.topicId === topicId) insert(request.quote)
    })
  }, [active, topicId, insert])

  const locateQuote = useCallback(
    (messageId: string) => {
      if (topicId) void EventEmitter.emit(EVENT_NAMES.LOCATE_QUOTED_MESSAGE, { topicId, messageId })
    },
    [topicId]
  )

  return { quotes, setQuotes, locateQuote }
}
