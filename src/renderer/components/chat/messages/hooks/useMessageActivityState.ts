import type {
  MessageActivityState,
  MessageActivityStore,
  MessageListItem
} from '@renderer/components/chat/messages/types'
import { isMessageListItemProcessing } from '@renderer/components/chat/messages/utils/messageListItem'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

const MESSAGE_ACTIVITY_STATE_CACHE = new Map<number, MessageActivityState>()

function getStableMessageActivityState(
  isProcessing: boolean,
  isApprovalAnchor: boolean,
  isActiveTurnProcessing: boolean,
  isStreamLive: boolean
): MessageActivityState {
  const key =
    Number(isProcessing) |
    (Number(isApprovalAnchor) << 1) |
    (Number(isActiveTurnProcessing) << 2) |
    (Number(isStreamLive) << 3)
  const cached = MESSAGE_ACTIVITY_STATE_CACHE.get(key)
  if (cached) return cached

  const state = Object.freeze({
    isProcessing,
    isStreamTarget: isProcessing,
    isApprovalAnchor,
    isActiveTurnProcessing,
    isStreamLive
  })
  MESSAGE_ACTIVITY_STATE_CACHE.set(key, state)
  return state
}

function deriveMessageActivityState(
  message: MessageListItem,
  isActiveExecutionTarget: boolean,
  isApprovalAnchor: boolean,
  topicStreamStatus: TopicStreamStatus | undefined
): MessageActivityState {
  const isProcessing = isMessageListItemProcessing(message) || isActiveExecutionTarget || isApprovalAnchor
  const topicTurnState = classifyTurn(topicStreamStatus)
  const isActiveTurnProcessing = isProcessing && (topicStreamStatus === undefined || topicTurnState.isTurnActive)
  const isStreamLive =
    isActiveTurnProcessing &&
    (topicStreamStatus === undefined ? message.status === 'pending' : topicTurnState.isStreamLive)

  return getStableMessageActivityState(isProcessing, isApprovalAnchor, isActiveTurnProcessing, isStreamLive)
}

export class KeyedMessageActivityStore implements MessageActivityStore {
  private activeMessageIds = new Set<string>()
  private approvalMessageIds = new Set<string>()
  private listeners = new Map<string, Map<() => void, MessageListItem>>()
  private topicStreamStatus: TopicStreamStatus | undefined
  private topicId: string | undefined

  getSnapshot = (message: MessageListItem): MessageActivityState => {
    const isApprovalAnchor = this.approvalMessageIds.has(message.id)
    return deriveMessageActivityState(
      message,
      this.activeMessageIds.has(message.id),
      isApprovalAnchor,
      this.topicStreamStatus
    )
  }

  subscribe = (message: MessageListItem, listener: () => void) => {
    const listeners = this.listeners.get(message.id) ?? new Map<() => void, MessageListItem>()
    listeners.set(listener, message)
    this.listeners.set(message.id, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(message.id)
      }
    }
  }

  update(
    activeMessageIds: Iterable<string>,
    approvalMessageIds: Iterable<string>,
    topicStreamStatus = this.topicStreamStatus
  ) {
    const nextActiveMessageIds = new Set(activeMessageIds)
    const nextApprovalMessageIds = new Set(approvalMessageIds)
    const previousSnapshots = new Map<string, Map<() => void, MessageActivityState>>()
    for (const [messageId, listeners] of this.listeners) {
      const messageSnapshots = new Map<() => void, MessageActivityState>()
      for (const [listener, message] of listeners) {
        messageSnapshots.set(listener, this.getSnapshot(message))
      }
      previousSnapshots.set(messageId, messageSnapshots)
    }

    this.activeMessageIds = nextActiveMessageIds
    this.approvalMessageIds = nextApprovalMessageIds
    this.topicStreamStatus = topicStreamStatus
    const changedListeners = new Set<() => void>()
    for (const [messageId, listeners] of this.listeners) {
      for (const [listener, message] of listeners) {
        if (previousSnapshots.get(messageId)?.get(listener) !== this.getSnapshot(message)) {
          changedListeners.add(listener)
        }
      }
    }
    changedListeners.forEach((listener) => listener())
  }

  syncTopic(
    topicId: string,
    activeMessageIds: Iterable<string>,
    approvalMessageIds: Iterable<string>,
    topicStreamStatus: TopicStreamStatus | undefined
  ) {
    if (this.topicId === topicId) {
      this.update(activeMessageIds, approvalMessageIds, topicStreamStatus)
      return
    }
    this.topicId = topicId
    this.update(activeMessageIds, approvalMessageIds, topicStreamStatus)
  }
}

interface MessageActivityCapability {
  getMessageActivityState: (message: MessageListItem) => MessageActivityState
  store: MessageActivityStore
}

export function useMessageActivityState(
  topicId: string,
  partsMap?: Record<string, CherryMessagePart[]> | null
): MessageActivityCapability {
  void partsMap
  const { status, activeExecutions = [], awaitingApprovalAnchors = [] } = useTopicStreamStatus(topicId)
  const statusRef = useRef(status)
  const activeExecutionsRef = useRef(activeExecutions)
  const awaitingApprovalAnchorsRef = useRef(awaitingApprovalAnchors)
  statusRef.current = status
  activeExecutionsRef.current = activeExecutions
  awaitingApprovalAnchorsRef.current = awaitingApprovalAnchors

  const storeRef = useRef<KeyedMessageActivityStore>(undefined as never)
  if (!storeRef.current) storeRef.current = new KeyedMessageActivityStore()
  const store = storeRef.current
  const getMessageActivityState = useCallback((message: MessageListItem) => {
    const isActiveExecutionTarget = activeExecutionsRef.current.some(
      (execution) => execution.anchorMessageId === message.id
    )
    const isApprovalAnchor = awaitingApprovalAnchorsRef.current.some(
      (execution) => execution.anchorMessageId === message.id
    )
    return deriveMessageActivityState(message, isActiveExecutionTarget, isApprovalAnchor, statusRef.current)
  }, [])

  useLayoutEffect(() => {
    store.syncTopic(
      topicId,
      activeExecutions.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : [])),
      awaitingApprovalAnchors.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : [])),
      status
    )
  }, [activeExecutions, awaitingApprovalAnchors, status, store, topicId])

  return useMemo(() => ({ getMessageActivityState, store }), [getMessageActivityState, store])
}
