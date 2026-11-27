import type { ReactNode } from 'react'
import { createContext, use, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ComposerSerializedToken } from '@renderer/components/composer/tokens'
import { useLatest } from '@renderer/hooks/useLatest'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

import type { MessageListItem } from '../messages/types'

export interface EditingMessageSnapshot {
  message: MessageListItem
  parts: CherryMessagePart[]
  lockedMentionedModels?: Model[]
  editingSessionId: number
}

export interface SavedComposerDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  mentionedModelMultiSelectMode: boolean
  mentionedModelSelectionWasPending: boolean
  selectedKnowledgeBases: KnowledgeBase[]
  knowledgeBaseIds: string[]
}

export interface StoredMessageEditDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
  knowledgeBaseIds: string[]
  reasoningDraft: string
  originalFilePartsByTokenId: ReadonlyMap<string, Extract<CherryMessagePart, { type: 'file' }>>
}

export interface StoredMessageEditSession {
  snapshot: EditingMessageSnapshot
  draft?: StoredMessageEditDraft
  savedDraftBeforeEditing?: SavedComposerDraft | null
}

const MAX_STORED_EDIT_SESSIONS = 50
const storedEditSessions = new Map<string, StoredMessageEditSession>()
let nextEditingSessionId = 0

function setStoredEditSession(topicId: string, session: StoredMessageEditSession) {
  storedEditSessions.delete(topicId)
  storedEditSessions.set(topicId, session)
  if (storedEditSessions.size > MAX_STORED_EDIT_SESSIONS) {
    const oldestKey = storedEditSessions.keys().next().value
    if (oldestKey !== undefined) storedEditSessions.delete(oldestKey)
  }
}

export function readMessageEditSession(topicId: string): StoredMessageEditSession | undefined {
  return storedEditSessions.get(topicId)
}

export function writeMessageEditSessionDraft(
  topicId: string,
  editingSessionId: number,
  update: {
    draft: StoredMessageEditDraft
    savedDraftBeforeEditing: SavedComposerDraft | null
  }
) {
  const existing = storedEditSessions.get(topicId)
  if (!existing || existing.snapshot.editingSessionId !== editingSessionId) return
  setStoredEditSession(topicId, {
    ...existing,
    draft: update.draft,
    savedDraftBeforeEditing: update.savedDraftBeforeEditing
  })
}

export function clearMessageEditSession(topicId: string, expectedSessionId?: number) {
  if (expectedSessionId !== undefined) {
    const existing = storedEditSessions.get(topicId)
    if (!existing || existing.snapshot.editingSessionId !== expectedSessionId) return
  }
  storedEditSessions.delete(topicId)
}

export function clearAllMessageEditSessions() {
  storedEditSessions.clear()
}

interface MessageEditingContextType {
  editingMessageId: string | null
  editingMessage: EditingMessageSnapshot | null
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
    topicId ? (readMessageEditSession(topicId)?.snapshot ?? null) : null
  )
  const editingMessageRef = useLatest(editingMessage)
  const prevTopicIdRef = useRef(topicId)

  const syncTopic = useCallback((nextTopicId: string | undefined) => {
    const nextSnapshot = nextTopicId ? (readMessageEditSession(nextTopicId)?.snapshot ?? null) : null
    setEditingMessage((current) => {
      if (current === nextSnapshot) return current
      if (current?.editingSessionId === nextSnapshot?.editingSessionId) return current
      return nextSnapshot
    })
  }, [])

  useLayoutEffect(() => {
    if (prevTopicIdRef.current === topicId) return
    prevTopicIdRef.current = topicId
    syncTopic(topicId)
  }, [syncTopic, topicId])

  const startEditing = useCallback(
    (message: MessageListItem, parts: CherryMessagePart[], options?: { lockedMentionedModels?: Model[] }) => {
      nextEditingSessionId += 1
      const snapshot: EditingMessageSnapshot = {
        message,
        parts,
        lockedMentionedModels: options?.lockedMentionedModels,
        editingSessionId: nextEditingSessionId
      }
      if (message.topicId) {
        setStoredEditSession(message.topicId, { snapshot })
      }
      setEditingMessage(snapshot)
    },
    []
  )

  const stopEditing = useCallback(() => {
    const current = editingMessageRef.current
    if (current?.message.topicId) {
      clearMessageEditSession(current.message.topicId, current.editingSessionId)
    }
    setEditingMessage(null)
  }, [editingMessageRef])

  const value = useMemo<MessageEditingContextType>(
    () => ({
      editingMessageId: editingMessage?.message.id ?? null,
      editingMessage,
      startEditing,
      cancelEditing: stopEditing,
      stopEditing,
      syncTopic
    }),
    [editingMessage, startEditing, stopEditing, syncTopic]
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
