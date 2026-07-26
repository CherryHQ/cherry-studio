import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'
import {
  createImageActionBus,
  type ImageActionRequest,
  type ImageActionType
} from '@renderer/utils/message/imageActionBus'

export type TopicImageActionType = ImageActionType

export type TopicImageActionRequest = ImageActionRequest<Topic, 'topic'>

interface RequestTopicImageActionOptions {
  emit?: boolean
}

const TOPIC_IMAGE_EVENT_NAMES: Record<TopicImageActionType, string> = {
  copy: EVENT_NAMES.COPY_TOPIC_IMAGE,
  export: EVENT_NAMES.EXPORT_TOPIC_IMAGE
}

const topicImageActionBus = createImageActionBus<Topic, 'topic', RequestTopicImageActionOptions>({
  targetKey: 'topic',
  getTargetId: (topic) => topic.id,
  onRequest: (type, topic, options) => {
    if (options?.emit !== false) {
      void EventEmitter.emit(TOPIC_IMAGE_EVENT_NAMES[type], topic)
    }
  }
})

export function requestTopicImageAction(
  type: TopicImageActionType,
  topic: Topic,
  options: RequestTopicImageActionOptions = {}
): TopicImageActionRequest {
  return topicImageActionBus.requestImageAction(type, topic, options)
}

export function settleTopicImageActionRequest(
  request: TopicImageActionRequest,
  actionPromise: Promise<void> | void
): void {
  topicImageActionBus.settleImageActionRequest(request, actionPromise)
}

export function consumePendingTopicImageActions(
  topicId: string,
  type?: TopicImageActionType
): TopicImageActionRequest[] {
  return topicImageActionBus.consumePendingImageActions(topicId, type)
}

export function rejectPendingTopicImageActions(topicId: string | undefined, reason: unknown): void {
  topicImageActionBus.rejectPendingImageActions(topicId, reason)
}

export function clearPendingTopicImageActionsForTest(): void {
  topicImageActionBus.clearPendingImageActionsForTest()
}
