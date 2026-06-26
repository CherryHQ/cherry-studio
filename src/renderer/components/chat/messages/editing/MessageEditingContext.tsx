import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'

import type { MessageListItem } from '../types'

export interface EditingMessageSnapshot {
  message: MessageListItem
  parts: CherryMessagePart[]
  lockedMentionedModels?: Model[]
  editingSessionId: number
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
}

const MessageEditingContext = createContext<MessageEditingContextType | null>(null)

export function MessageEditingProvider({ children }: { children: ReactNode }) {
  const parent = use(MessageEditingContext)
  const [editingMessage, setEditingMessage] = useState<EditingMessageSnapshot | null>(null)
  const editingSessionIdRef = useRef(0)

  const startEditing = useCallback(
    (message: MessageListItem, parts: CherryMessagePart[], options?: { lockedMentionedModels?: Model[] }) => {
      editingSessionIdRef.current += 1
      setEditingMessage({
        message,
        parts,
        lockedMentionedModels: options?.lockedMentionedModels,
        editingSessionId: editingSessionIdRef.current
      })
    },
    []
  )

  const stopEditing = useCallback(() => {
    setEditingMessage(null)
  }, [])

  const value = useMemo<MessageEditingContextType>(
    () => ({
      editingMessageId: editingMessage?.message.id ?? null,
      editingMessage,
      startEditing,
      cancelEditing: stopEditing,
      stopEditing
    }),
    [editingMessage, startEditing, stopEditing]
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
