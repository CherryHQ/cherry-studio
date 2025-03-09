import PQueue from 'p-queue'

// Queue configuration - managed by topic
const requestQueues: { [topicId: string]: PQueue } = {}

/**
 * Get or create a queue for a specific topic
 * @param topicId The ID of the topic
 * @returns A PQueue instance for the topic
 */
export const getTopicQueue = (topicId: string): PQueue => {
  if (!requestQueues[topicId]) {
    requestQueues[topicId] = new PQueue({
      concurrency: 4,
      timeout: 1000 * 60 * 5, // 5 minutes
      throwOnTimeout: false
    })
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
    delete requestQueues[topicId]
  }
}

/**
 * Clear all topic queues
 */
export const clearAllQueues = (): void => {
  Object.keys(requestQueues).forEach((topicId) => {
    requestQueues[topicId].clear()
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
