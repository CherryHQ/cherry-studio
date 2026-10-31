import type { ReactNode } from 'react'
import { createContext, use, useMemo, useState } from 'react'

interface ChatLayoutModeContextValue {
  forceWideLayout: boolean
  setForceWideLayout: (forceWideLayout: boolean) => void
  /** Right-hand gutter (px) the content yields to the anchor rail. Grows/shrinks
   * smoothly with width so the rail fades in/out and the content never jumps. */
  railGutterPx: number
  setRailGutterPx: (railGutterPx: number) => void
  /** Side padding (px) of the message column and the composer, before the rail gutter. Matches
   * NarrowLayout's `px-6`, so the inline override is invisible until the rail gutter adds onto it. */
  sidePaddingPx: number
  /** Extra right-hand inset (px) of the message column alone, on top of the side padding. */
  messageEndInsetPx: number
}

const CHAT_SIDE_PADDING_PX = 24

const ChatLayoutModeContext = createContext<ChatLayoutModeContextValue>({
  forceWideLayout: false,
  setForceWideLayout: () => {},
  railGutterPx: 0,
  setRailGutterPx: () => {},
  sidePaddingPx: CHAT_SIDE_PADDING_PX,
  messageEndInsetPx: 0
})

export const ChatLayoutModeProvider = ({ children }: { children: ReactNode }) => {
  const [forceWideLayout, setForceWideLayout] = useState(false)
  const [railGutterPx, setRailGutterPx] = useState(0)
  const value = useMemo(
    () => ({
      forceWideLayout,
      setForceWideLayout,
      railGutterPx,
      setRailGutterPx,
      sidePaddingPx: CHAT_SIDE_PADDING_PX,
      messageEndInsetPx: 0
    }),
    [forceWideLayout, railGutterPx]
  )

  return <ChatLayoutModeContext value={value}>{children}</ChatLayoutModeContext>
}

/** Narrows the chat's side padding for a compact window, keeping the surrounding layout mode. */
export const ChatSidePaddingProvider = ({
  sidePaddingPx,
  messageEndInsetPx = 0,
  children
}: {
  sidePaddingPx: number
  messageEndInsetPx?: number
  children: ReactNode
}) => {
  const layoutMode = use(ChatLayoutModeContext)
  const value = useMemo(
    () => ({ ...layoutMode, sidePaddingPx, messageEndInsetPx }),
    [layoutMode, sidePaddingPx, messageEndInsetPx]
  )
  return <ChatLayoutModeContext value={value}>{children}</ChatLayoutModeContext>
}

export const useChatLayoutMode = () => use(ChatLayoutModeContext)
