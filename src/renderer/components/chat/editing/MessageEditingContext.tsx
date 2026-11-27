import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useLatest } from '@renderer/hooks/useLatest'
import {
  type EditingMessageSnapshot as ServiceEditingMessageSnapshot,
  messageEditingSessionService,
  type SavedComposerDraft,
  type StoredMessageEditDraft,
  type StoredMessageEditSession as ServiceStoredMessageEditSession
} from '@renderer/services/MessageEditingSessionService'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

import type { MessageListItem } from '../messages/types'

export type EditingMessageSnapshot = ServiceEditingMessageSnapshot<MessageListItem>
export type StoredMessageEditSession = ServiceStoredMessageEditSession<MessageListItem>
export type { SavedComposerDraft, StoredMessageEditDraft }

interface MessageEditingContextType {
  editingMessageId: string | null
  editingMessage: EditingMessageSnapshot | null
  isSavingEditing: boolean
  startEditing: (
    message: MessageListItem,
    parts: CherryMessagePart[],
    options?: { lockedMentionedModels?: Model[] }
  ) => void
  cancelEditing: () => void
  stopEditing: () => void
  syncTopic: (topicId: string | undefined) => void
}

const MessageEditingContext = createContext<MessageEditingContextType | null>(null)

export function MessageEditingProvider({ topicId, children }: { topicId?: string; children: ReactNode }) {
  const parent = use(MessageEditingContext)
  const [editingMessage, setEditingMessage] = useState<EditingMessageSnapshot | null>(() =>
    topicId ? (messageEditingSessionService.getSession<MessageListItem>(topicId)?.snapshot ?? null) : null
  )
  const [isSavingEditing, setIsSavingEditing] = useState<boolean>(() =>
    topicId ? (messageEditingSessionService.getSession<MessageListItem>(topicId)?.isSaving ?? false) : false
  )
  const editingMessageRef = useLatest(editingMessage)
  const prevTopicIdRef = useRef(topicId)
  const activeTopicIdRef = useRef<string | undefined>(topicId)

  const syncTopic = useCallback((nextTopicId: string | undefined) => {
    activeTopicIdRef.current = nextTopicId
    const stored = nextTopicId ? messageEditingSessionService.getSession<MessageListItem>(nextTopicId) : undefined
    const nextSnapshot = stored?.snapshot ?? null
    setEditingMessage((current) => {
      if (current === nextSnapshot) return current
      if (current?.editingSessionId === nextSnapshot?.editingSessionId) return current
      return nextSnapshot
    })
    setIsSavingEditing(stored?.isSaving ?? false)
  }, [])

  useLayoutEffect(() => {
    if (prevTopicIdRef.current === topicId) return
    prevTopicIdRef.current = topicId
    syncTopic(topicId)
  }, [syncTopic, topicId])

  useEffect(() => {
    if (parent) return
    return messageEditingSessionService.subscribe(() => {
      const currentTopicId = activeTopicIdRef.current
      if (!currentTopicId) return
      const stored = messageEditingSessionService.getSession<MessageListItem>(currentTopicId)
      const nextSnapshot = stored?.snapshot ?? null
      setEditingMessage((current) => {
        if (current === nextSnapshot) return current
        if (current?.editingSessionId === nextSnapshot?.editingSessionId) return current
        return nextSnapshot
      })
      setIsSavingEditing(stored?.isSaving ?? false)
    })
  }, [parent])

  const startEditing = useCallback(
    (message: MessageListItem, parts: CherryMessagePart[], options?: { lockedMentionedModels?: Model[] }) => {
      if (message.topicId) activeTopicIdRef.current = message.topicId
      const snapshot = messageEditingSessionService.startSession(message, parts, options)
      setEditingMessage(snapshot)
      setIsSavingEditing(false)
    },
    []
  )

  const stopEditing = useCallback(() => {
    const current = editingMessageRef.current
    if (current?.message.topicId) {
      messageEditingSessionService.clearSession(current.message.topicId, current.editingSessionId)
    }
    setEditingMessage(null)
    setIsSavingEditing(false)
  }, [editingMessageRef])

  const value = useMemo<MessageEditingContextType>(
    () => ({
      editingMessageId: editingMessage?.message.id ?? null,
      editingMessage,
      isSavingEditing,
      startEditing,
      cancelEditing: stopEditing,
      stopEditing,
      syncTopic
    }),
    [editingMessage, isSavingEditing, startEditing, stopEditing, syncTopic]
  )

  if (parent) return <>{children}</>

  return <MessageEditingContext value={value}>{children}</MessageEditingContext>
}

export function useMessageEditing() {
  const context = use(MessageEditingContext)
  if (!context) {
    throw new Error('useMessageEditing must be used within a MessageEditingProvider')
  }
  return context
}
