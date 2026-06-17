import { createContext, type ReactNode, use, useCallback, useState } from 'react'

export interface ChatBottomOverlayInsets {
  contentBottomPadding: number
  scrollerBottomMargin: number
}

const ChatBottomOverlayInsetContext = createContext<ChatBottomOverlayInsets | null>(null)
const NOOP_SET_BOTTOM_INSET = () => undefined
const ChatMaximizedOverlayBottomInsetContext = createContext(0)
const SetChatMaximizedOverlayBottomInsetContext = createContext<(value: number) => void>(NOOP_SET_BOTTOM_INSET)

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

export function ChatMaximizedOverlayInsetProvider({ children }: { children: ReactNode }) {
  const [bottomInset, setBottomInsetState] = useState(0)
  const setBottomInset = useCallback((value: number) => {
    const nextInset = Math.max(0, Math.round(value))
    setBottomInsetState((currentInset) => (currentInset === nextInset ? currentInset : nextInset))
  }, [])

  return (
    <SetChatMaximizedOverlayBottomInsetContext value={setBottomInset}>
      <ChatMaximizedOverlayBottomInsetContext value={bottomInset}>{children}</ChatMaximizedOverlayBottomInsetContext>
    </SetChatMaximizedOverlayBottomInsetContext>
  )
}

export function useChatMaximizedOverlayBottomInset() {
  return use(ChatMaximizedOverlayBottomInsetContext)
}

export function useSetChatMaximizedOverlayBottomInset() {
  return use(SetChatMaximizedOverlayBottomInsetContext)
}
