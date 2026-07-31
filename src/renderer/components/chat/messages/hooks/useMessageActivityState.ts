import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

import type {
  MessageActivityState,
  MessageActivityStore,
  MessageListItem
} from '@renderer/components/chat/messages/types'
import { isMessageListItemProcessing } from '@renderer/components/chat/messages/utils/messageListItem'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { CherryMessagePart } from '@shared/data/types/message'

const INACTIVE_MESSAGE_ACTIVITY_STATE: MessageActivityState = Object.freeze({
  isProcessing: false,
  isStreamTarget: false,
  isApprovalAnchor: false
})
const PROCESSING_MESSAGE_ACTIVITY_STATE: MessageActivityState = Object.freeze({
  isProcessing: true,
  isStreamTarget: true,
  isApprovalAnchor: false
})
const APPROVAL_MESSAGE_ACTIVITY_STATE: MessageActivityState = Object.freeze({
  isProcessing: true,
  isStreamTarget: true,
  isApprovalAnchor: true
})

export class KeyedMessageActivityStore implements MessageActivityStore {
  private activeMessageIds = new Set<string>()
  private approvalMessageIds = new Set<string>()
  private listeners = new Map<string, Set<() => void>>()
  private topicId: string | undefined

  getSnapshot = (message: MessageListItem): MessageActivityState => {
    const isApprovalAnchor = this.approvalMessageIds.has(message.id)
    const isProcessing =
      isMessageListItemProcessing(message) || this.activeMessageIds.has(message.id) || isApprovalAnchor
    if (isApprovalAnchor) return APPROVAL_MESSAGE_ACTIVITY_STATE
    return isProcessing ? PROCESSING_MESSAGE_ACTIVITY_STATE : INACTIVE_MESSAGE_ACTIVITY_STATE
  }

  subscribe = (messageId: string, listener: () => void) => {
    const listeners = this.listeners.get(messageId) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(messageId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(messageId)
      }
    }
  }

  update(activeMessageIds: Iterable<string>, approvalMessageIds: Iterable<string>) {
    const nextActiveMessageIds = new Set(activeMessageIds)
    const nextApprovalMessageIds = new Set(approvalMessageIds)
    const candidates = new Set([
      ...this.activeMessageIds,
      ...this.approvalMessageIds,
      ...nextActiveMessageIds,
      ...nextApprovalMessageIds
    ])

    const changedMessageIds = [...candidates].filter((messageId) => {
      const wasApprovalAnchor = this.approvalMessageIds.has(messageId)
      const isApprovalAnchor = nextApprovalMessageIds.has(messageId)
      const wasProcessing = this.activeMessageIds.has(messageId) || wasApprovalAnchor
      const isProcessing = nextActiveMessageIds.has(messageId) || isApprovalAnchor
      return wasProcessing !== isProcessing || wasApprovalAnchor !== isApprovalAnchor
    })
    if (changedMessageIds.length === 0) return

    this.activeMessageIds = nextActiveMessageIds
    this.approvalMessageIds = nextApprovalMessageIds
    for (const messageId of changedMessageIds) {
      this.listeners.get(messageId)?.forEach((listener) => listener())
    }
  }

  syncTopic(topicId: string, activeMessageIds: Iterable<string>, approvalMessageIds: Iterable<string>) {
    if (this.topicId === topicId) {
      this.update(activeMessageIds, approvalMessageIds)
      return
    }
    this.topicId = topicId
    this.update(activeMessageIds, approvalMessageIds)
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
  const { activeExecutions = [], awaitingApprovalAnchors = [] } = useTopicStreamStatus(topicId)
  const activeExecutionsRef = useRef(activeExecutions)
  const awaitingApprovalAnchorsRef = useRef(awaitingApprovalAnchors)
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
    const isProcessing = isMessageListItemProcessing(message) || isActiveExecutionTarget || isApprovalAnchor

    return { isProcessing, isStreamTarget: isProcessing, isApprovalAnchor }
  }, [])

  useLayoutEffect(() => {
    store.syncTopic(
      topicId,
      activeExecutions.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : [])),
      awaitingApprovalAnchors.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : []))
    )
  }, [activeExecutions, awaitingApprovalAnchors, store, topicId])

  return useMemo(() => ({ getMessageActivityState, store }), [getMessageActivityState, store])
}
