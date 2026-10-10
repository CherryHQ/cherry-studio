import { useCallback, useEffect, useRef, useState } from 'react'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

export function useComposerFocusRequest(activeTopicId: string | null | undefined) {
  const requestedTopicIdRef = useRef<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const requestedTopicId = requestedTopicIdRef.current
    if (!requestedTopicId || requestedTopicId !== activeTopicId) return

    requestedTopicIdRef.current = null
    void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: requestedTopicId })
  }, [activeTopicId, requestVersion])

  return useCallback((topicId: string) => {
    requestedTopicIdRef.current = topicId
    setRequestVersion((version) => version + 1)
  }, [])
}
