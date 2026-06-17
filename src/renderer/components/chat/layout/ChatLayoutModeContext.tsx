import type { ReactNode } from 'react'
import { createContext, use, useMemo, useState } from 'react'

interface ChatLayoutModeContextValue {
  forceWideLayout: boolean
  setForceWideLayout: (forceWideLayout: boolean) => void
}

const ChatLayoutModeContext = createContext<ChatLayoutModeContextValue>({
  forceWideLayout: false,
  setForceWideLayout: () => {}
})

export const ChatLayoutModeProvider = ({ children }: { children: ReactNode }) => {
  const [forceWideLayout, setForceWideLayout] = useState(false)
  const value = useMemo(
    () => ({
      forceWideLayout,
      setForceWideLayout
    }),
    [forceWideLayout]
  )

  return <ChatLayoutModeContext value={value}>{children}</ChatLayoutModeContext>
}

export const useChatLayoutMode = () => use(ChatLayoutModeContext)
