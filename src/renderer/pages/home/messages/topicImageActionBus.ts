import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'

export type TopicImageActionType = 'copy' | 'export'

export interface TopicImageActionRequest {
  id: number
  promise: Promise<void>
  topic: Topic
  type: TopicImageActionType
}

interface TopicImageActionSettlement {
  reject: (reason?: unknown) => void
  resolve: () => void
}

const TOPIC_IMAGE_EVENT_NAMES: Record<TopicImageActionType, string> = {
  copy: EVENT_NAMES.COPY_TOPIC_IMAGE,
  export: EVENT_NAMES.EXPORT_TOPIC_IMAGE
}

let nextRequestId = 1
let pendingRequests: TopicImageActionRequest[] = []
const settlements = new Map<number, TopicImageActionSettlement>()

export function requestTopicImageAction(type: TopicImageActionType, topic: Topic): TopicImageActionRequest {
  let settlement: TopicImageActionSettlement | undefined
  const promise = new Promise<void>((resolve, reject) => {
    settlement = { resolve, reject }
  })
  const request = { id: nextRequestId++, promise, type, topic }
  settlements.set(request.id, settlement as TopicImageActionSettlement)
  pendingRequests.push(request)
  void EventEmitter.emit(TOPIC_IMAGE_EVENT_NAMES[type], topic)
  return request
}

export function settleTopicImageActionRequest(
  request: TopicImageActionRequest,
  actionPromise: Promise<void> | void
): void {
  const settlement = settlements.get(request.id)
  if (!settlement) return

  settlements.delete(request.id)
  void Promise.resolve(actionPromise).then(settlement.resolve, settlement.reject)
}

export function consumePendingTopicImageActions(
  topicId: string,
  type?: TopicImageActionType
): TopicImageActionRequest[] {
  const matches: TopicImageActionRequest[] = []
  const remaining: TopicImageActionRequest[] = []

  for (const request of pendingRequests) {
    if (request.topic.id === topicId && (!type || request.type === type)) {
      matches.push(request)
    } else {
      remaining.push(request)
    }
  }

  pendingRequests = remaining
  return matches
}

export function rejectPendingTopicImageActions(topicId: string | undefined, reason: unknown): void {
  const remaining: TopicImageActionRequest[] = []

  for (const request of pendingRequests) {
    if (topicId === undefined || request.topic.id === topicId) {
      const settlement = settlements.get(request.id)
      settlements.delete(request.id)
      settlement?.reject(reason)
    } else {
      remaining.push(request)
    }
  }

  pendingRequests = remaining
}

export function clearPendingTopicImageActionsForTest(): void {
  pendingRequests = []
  settlements.clear()
  nextRequestId = 1
}
