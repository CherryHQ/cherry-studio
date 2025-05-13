import { createContext, use, useState } from 'react'

interface MessageEditContextType {
  editingMessageId: string | null
  startEditing: (messageId: string) => void
  stopEditing: () => void
  isEditing: (messageId: string) => boolean
}

const MessageEditContext = createContext<MessageEditContextType>({
  editingMessageId: null,
  startEditing: () => {},
  stopEditing: () => {},
  isEditing: () => false
})

export const MessageEditProvider = ({ children }: { children: React.ReactNode }) => {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  const startEditing = (messageId: string) => {
    setEditingMessageId(messageId)
  }

  const stopEditing = () => {
    setEditingMessageId(null)
  }

  const isEditing = (messageId: string) => {
    return editingMessageId === messageId
  }

  return (
    <MessageEditContext value={{ editingMessageId, startEditing, stopEditing, isEditing }}>
      {children}
    </MessageEditContext>
  )
}

export const useMessageEdit = () => {
  const context = use(MessageEditContext)
  if (!context) {
    throw new Error('useMessageEdit must be used within a MessageEditProvider')
  }
  return context
}
