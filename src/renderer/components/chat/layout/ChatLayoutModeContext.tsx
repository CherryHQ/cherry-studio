import type { CSSProperties, ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'

export const CHAT_RAIL_GUTTER_PROPERTY = '--chat-rail-gutter'
export const CHAT_RAIL_OPACITY_PROPERTY = '--chat-rail-opacity'
export const CHAT_RAIL_REST_OPACITY_PROPERTY = '--chat-rail-rest-opacity'

interface ChatLayoutModeContextValue {
  forceWideLayout: boolean
  setForceWideLayout: (forceWideLayout: boolean) => void
  /** Writes continuously changing rail measurements directly to inherited CSS
   * properties, without invalidating every React context consumer. */
  setRailGutter: (railGutterPx: number, railOpacity: number) => void
  /** Lets a remounted message list preserve the current discrete visibility state. */
  getRailGutterPx: () => number
}

const ChatLayoutModeContext = createContext<ChatLayoutModeContextValue>({
  forceWideLayout: false,
  setForceWideLayout: () => {},
  setRailGutter: () => {},
  getRailGutterPx: () => 0
})

export const ChatLayoutModeProvider = ({ children }: { children: ReactNode }) => {
  const [forceWideLayout, setForceWideLayout] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)
  const railGutterPxRef = useRef(0)
  const setRailGutter = useCallback((railGutterPx: number, railOpacity: number) => {
    railGutterPxRef.current = railGutterPx
    layoutRef.current?.style.setProperty(CHAT_RAIL_GUTTER_PROPERTY, `${railGutterPx}px`)
    layoutRef.current?.style.setProperty(CHAT_RAIL_OPACITY_PROPERTY, String(railOpacity))
    layoutRef.current?.style.setProperty(CHAT_RAIL_REST_OPACITY_PROPERTY, String(railOpacity * 0.7))
  }, [])
  const getRailGutterPx = useCallback(() => railGutterPxRef.current, [])
  const value = useMemo(
    () => ({
      forceWideLayout,
      setForceWideLayout,
      setRailGutter,
      getRailGutterPx
    }),
    [forceWideLayout, getRailGutterPx, setRailGutter]
  )

  return (
    <ChatLayoutModeContext value={value}>
      <div
        ref={layoutRef}
        className="contents"
        style={
          {
            [CHAT_RAIL_GUTTER_PROPERTY]: '0px',
            [CHAT_RAIL_OPACITY_PROPERTY]: 0,
            [CHAT_RAIL_REST_OPACITY_PROPERTY]: 0
          } as CSSProperties
        }>
        {children}
      </div>
    </ChatLayoutModeContext>
  )
}

export const useChatLayoutMode = () => use(ChatLayoutModeContext)
