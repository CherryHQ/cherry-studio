import type { ReactNode } from 'react'
import { createContext, use, useMemo, useState } from 'react'

interface ChatLayoutModeContextValue {
  forceWideLayout: boolean
  setForceWideLayout: (forceWideLayout: boolean) => void
  /** Right-hand gutter (px) the content yields to the anchor rail. Grows/shrinks
   * smoothly with width so the rail fades in/out and the content never jumps. */
  railGutterPx: number
  setRailGutterPx: (railGutterPx: number) => void
}

const ChatLayoutModeContext = createContext<ChatLayoutModeContextValue>({
  forceWideLayout: false,
  setForceWideLayout: () => {},
  railGutterPx: 0,
  setRailGutterPx: () => {}
})

export const ChatLayoutModeProvider = ({ children }: { children: ReactNode }) => {
  const [forceWideLayout, setForceWideLayout] = useState(false)
  const [railGutterPx, setRailGutterPx] = useState(0)
  const value = useMemo(
    () => ({
      forceWideLayout,
      setForceWideLayout,
      railGutterPx,
      setRailGutterPx
    }),
    [forceWideLayout, railGutterPx]
  )

  return <ChatLayoutModeContext value={value}>{children}</ChatLayoutModeContext>
}

export const useChatLayoutMode = () => use(ChatLayoutModeContext)
