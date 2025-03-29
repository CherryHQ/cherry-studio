import { EventEmitter } from '@renderer/services/EventService'
import { Topic } from '@renderer/types'
import { hasTopicPendingRequests } from '@renderer/utils/queue'
import { QUEUE_EVENTS } from '@renderer/utils/queue'
import { useEffect, useState } from 'react'

/**
 * Event-based queue state monitoring hook
 * @param topics Topic array
 * @returns Whether there is a pending request
 */
export const useTopicsQueueStateWithEvent = (topics: Topic[]): boolean => {
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    // Check the initial state of all topics' queues
    const checkInitialState = () => {
      const hasProcessing = topics.some((topic) => hasTopicPendingRequests(topic.id))
      setIsProcessing(hasProcessing)
    }

    // Check the initial state immediately
    checkInitialState()

    const topicIds = new Set(topics.map((topic) => topic.id))

    const handleStateChange = ({ topicId, hasPending }: { topicId: string; hasPending: boolean }) => {
      if (topicIds.has(topicId)) {
        if (hasPending) {
          // If any topic's queue has pending tasks, set it to processing
          setIsProcessing(true)
        } else {
          // This ensures that when one topic is completed but others are still processing, the state remains correct
          checkInitialState()
        }
      }
    }

    const handleQueueIdle = ({ topicId }: { topicId: string }) => {
      if (topicIds.has(topicId)) {
        // When a queue becomes idle, check all topics again
        checkInitialState()
      }
    }

    EventEmitter.on(QUEUE_EVENTS.STATE_CHANGED, handleStateChange)
    EventEmitter.on(QUEUE_EVENTS.QUEUE_IDLE, handleQueueIdle)

    return () => {
      EventEmitter.off(QUEUE_EVENTS.STATE_CHANGED, handleStateChange)
      EventEmitter.off(QUEUE_EVENTS.QUEUE_IDLE, handleQueueIdle)
    }
  }, [topics])

  return isProcessing
}
