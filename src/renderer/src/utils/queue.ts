import { EventEmitter } from '@renderer/services/EventService'
import PQueue from 'p-queue'

// Define queue event names
export const QUEUE_EVENTS = {
  STATE_CHANGED: 'queue:state_changed',
  TASK_ADDED: 'queue:task_added',
  TASK_COMPLETED: 'queue:task_completed',
  QUEUE_IDLE: 'queue:idle'
}

// Queue configuration - managed by topic
const requestQueues: { [topicId: string]: PQueue } = {}

/**
 * Add event listeners to the queue
 * @param queue PQueue instance
 * @param topicId Topic ID
 */
const addQueueEventListeners = (queue: PQueue, topicId: string) => {
  // Remove existing event listeners to avoid duplicates
  queue.removeAllListeners('add')
  queue.removeAllListeners('completed')
  queue.removeAllListeners('idle')

  // Add new event listeners
  queue.on('add', () => {
    EventEmitter.emit(QUEUE_EVENTS.TASK_ADDED, { topicId })
    EventEmitter.emit(QUEUE_EVENTS.STATE_CHANGED, { topicId, hasPending: true })
  })

  queue.on('completed', () => {
    EventEmitter.emit(QUEUE_EVENTS.TASK_COMPLETED, { topicId })
    // Check the queue status and emit the corresponding event
    const hasPending = queue.size > 0 || queue.pending > 0
    EventEmitter.emit(QUEUE_EVENTS.STATE_CHANGED, { topicId, hasPending })
  })

  queue.on('idle', () => {
    // Make sure to send the state change event when the queue is idle
    EventEmitter.emit(QUEUE_EVENTS.QUEUE_IDLE, { topicId })
    EventEmitter.emit(QUEUE_EVENTS.STATE_CHANGED, { topicId, hasPending: false })
  })
}

/**
 * Get or create a queue for a specific topic
 * @param topicId The ID of the topic
 * @returns A PQueue instance for the topic
 */
export const getTopicQueue = (topicId: string, options = {}): PQueue => {
  if (!requestQueues[topicId]) {
    const queue = new PQueue(options)
    // Add event listeners to the new queue
    addQueueEventListeners(queue, topicId)
    requestQueues[topicId] = queue
  } else {
    // Make sure the existing queue also has event listeners
    addQueueEventListeners(requestQueues[topicId], topicId)
  }
  return requestQueues[topicId]
}

/**
 * Clear the queue for a specific topic
 * @param topicId The ID of the topic
 */
export const clearTopicQueue = (topicId: string): void => {
  if (requestQueues[topicId]) {
    requestQueues[topicId].clear()
    EventEmitter.emit(QUEUE_EVENTS.STATE_CHANGED, { topicId, hasPending: false })
    delete requestQueues[topicId]
  }
}

/**
 * Clear all topic queues
 */
export const clearAllQueues = (): void => {
  Object.keys(requestQueues).forEach((topicId) => {
    requestQueues[topicId].clear()
    EventEmitter.emit(QUEUE_EVENTS.STATE_CHANGED, { topicId, hasPending: false })
    delete requestQueues[topicId]
  })
}

/**
 * Check if a topic has pending requests
 * @param topicId The ID of the topic
 * @returns True if the topic has pending requests
 */
export const hasTopicPendingRequests = (topicId: string): boolean => {
  return requestQueues[topicId]?.size > 0 || requestQueues[topicId]?.pending > 0
}

/**
 * Get the number of pending requests for a topic
 * @param topicId The ID of the topic
 * @returns The number of pending requests
 */
export const getTopicPendingRequestCount = (topicId: string): number => {
  if (!requestQueues[topicId]) {
    return 0
  }
  return requestQueues[topicId].size + requestQueues[topicId].pending
}

/**
 * Wait for all pending requests in a topic queue to complete
 * @param topicId The ID of the topic
 */
export const waitForTopicQueue = async (topicId: string): Promise<void> => {
  if (requestQueues[topicId]) {
    await requestQueues[topicId].onIdle()
  }
}
