import { createContext, type ReactNode, use } from 'react'

/**
 * How the page is framed by its host window.
 * - `embedded`: rendered inside the main window below the tab bar (the default).
 * - `window`: the page owns the whole window — its navbar doubles as the OS title bar.
 */
export type WindowFrameMode = 'embedded' | 'window'

/** Window chrome the host window injects into the page's title bar (composition, not flags). */
export interface WindowFrameChrome {
  /** Left of the title bar, e.g. the conversation's emoji + name. */
  titleLeading?: ReactNode
  /** Left of the page's own top-right tool, e.g. pin + back-to-main. */
  titleTrailing?: ReactNode
}

export interface WindowFrame {
  mode: WindowFrameMode
  chrome?: WindowFrameChrome
}

const EMBEDDED_FRAME: WindowFrame = { mode: 'embedded' }
const WindowFrameContext = createContext<WindowFrame>(EMBEDDED_FRAME)

export function WindowFrameProvider({ value, children }: { value: WindowFrame; children: ReactNode }) {
  return <WindowFrameContext value={value}>{children}</WindowFrameContext>
}

/** The current window frame. Defaults to `{ mode: 'embedded' }` when no provider is present. */
export function useWindowFrame(): WindowFrame {
  return use(WindowFrameContext)
}
