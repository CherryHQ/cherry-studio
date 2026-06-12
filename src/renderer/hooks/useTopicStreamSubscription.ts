/**
 * React binding for {@link TopicStreamSubscription}. One subscription per
 * mounted `topicId`; disposed on unmount or topic switch (which detaches the
 * Main listener and closes all branch streams). Consumed by
 * `useExecutionOverlay`.
 */
import { TopicStreamSubscription } from '@renderer/transport/TopicStreamSubscription'
import { useEffect, useRef } from 'react'

export function useTopicStreamSubscription(topicId: string): TopicStreamSubscription {
  // Lazy-init per topicId (same idiom as `useState(() => ...)`); disposal is
  // driven by effects so render stays free of observable side effects.
  const ref = useRef<{ topicId: string; sub: TopicStreamSubscription } | null>(null)
  if (!ref.current || ref.current.topicId !== topicId) {
    ref.current = { topicId, sub: new TopicStreamSubscription(topicId) }
  }
  const sub = ref.current.sub

  useEffect(() => {
    sub.listen()
    return () => sub.dispose()
  }, [sub])

  return sub
}
