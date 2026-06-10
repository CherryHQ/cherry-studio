import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'

export interface EditingMessageSnapshot {
  message: MessageListItem
  parts: CherryMessagePart[]
  editingSessionId: number
}

interface MessageEditingContextType {
  editingMessageId: string | null
  editingMessage: EditingMessageSnapshot | null
  startEditing: (message: MessageListItem, parts: CherryMessagePart[]) => void
  cancelEditing: () => void
  stopEditing: () => void
}

const MessageEditingContext = createContext<MessageEditingContextType | null>(null)

export function MessageEditingProvider({ children }: { children: ReactNode }) {
  const parent = use(MessageEditingContext)
  const [editingMessage, setEditingMessage] = useState<EditingMessageSnapshot | null>(null)
  const editingSessionIdRef = useRef(0)

  const startEditing = useCallback((message: MessageListItem, parts: CherryMessagePart[]) => {
    editingSessionIdRef.current += 1
    setEditingMessage({ message, parts, editingSessionId: editingSessionIdRef.current })
  }, [])

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
