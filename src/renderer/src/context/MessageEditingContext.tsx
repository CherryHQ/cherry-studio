import { createContext, ReactNode, use, useState } from 'react'

interface MessageEditingContextType {
  editingMessageId: string | null
  startEditing: (messageId: string) => void
  stopEditing: () => void
}

const MessageEditingContext = createContext<MessageEditingContextType | null>(null)

export function MessageEditingProvider({ children }: { children: ReactNode }) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  const startEditing = (messageId: string) => {
    setEditingMessageId(messageId)
  }

  const stopEditing = () => {
    setEditingMessageId(null)
  }

  return (
    <MessageEditingContext value={{ editingMessageId, startEditing, stopEditing }}>{children}</MessageEditingContext>
  )
}

export function useMessageEditing() {
  const context = use(MessageEditingContext)
  if (!context) {
    throw new Error('useMessageEditing must be used within a MessageEditingProvider')
  }
  return context
}
