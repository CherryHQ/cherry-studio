import type { ReactNode } from 'react'
import { createContext, use } from 'react'

import type { MessageListProviderValue } from './types'

const MessageListContext = createContext<MessageListProviderValue | null>(null)

export const MessageListProvider = ({ value, children }: { value: MessageListProviderValue; children: ReactNode }) => (
  <MessageListContext value={value}>{children}</MessageListContext>
)

export const useOptionalMessageList = (): MessageListProviderValue | null => {
  return use(MessageListContext)
}

export const useMessageList = (): MessageListProviderValue => {
  const value = use(MessageListContext)
  if (!value) {
    throw new Error('useMessageList must be used within MessageListProvider')
  }
  return value
}
