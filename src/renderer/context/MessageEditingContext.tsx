import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useState } from 'react'

export interface EditingMessageSnapshot {
  message: MessageListItem
  parts: CherryMessagePart[]
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

  const startEditing = useCallback((message: MessageListItem, parts: CherryMessagePart[]) => {
    setEditingMessage({ message, parts })
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
