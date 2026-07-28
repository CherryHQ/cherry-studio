import { createContext, type ReactNode, use } from 'react'

export interface ChatBottomOverlayInsets {
  contentBottomPadding: number
  scrollerBottomMargin: number
}

const ChatBottomOverlayInsetContext = createContext<ChatBottomOverlayInsets | null>(null)

export function ChatBottomOverlayInsetProvider({
  value,
  children
}: {
  value: ChatBottomOverlayInsets | null
  children: ReactNode
}) {
  return <ChatBottomOverlayInsetContext value={value}>{children}</ChatBottomOverlayInsetContext>
}

export function useChatBottomOverlayInset() {
  return use(ChatBottomOverlayInsetContext)
}
