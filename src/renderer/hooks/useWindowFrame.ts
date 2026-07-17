import { createContext, type ReactNode, use } from 'react'

/**
 * How the page is framed by its host window.
 * - `embedded`: rendered inside the main window below the tab bar (the default).
 * - `window`: the page owns the whole window and may merge host chrome into its navbar.
 */
export type WindowFrameMode = 'embedded' | 'window'

/** Window chrome composed by the host into a page-owned title bar. */
export interface WindowFrameChrome {
  titleLeading?: ReactNode
  titleTrailing?: ReactNode
}

export interface WindowFrame {
  mode: WindowFrameMode
  /** Whether the host currently renders this page over a translucent window material. */
  translucent?: boolean
  chrome?: WindowFrameChrome
}

const EMBEDDED_FRAME: WindowFrame = { mode: 'embedded' }
export const WindowFrameContext = createContext<WindowFrame>(EMBEDDED_FRAME)

/** The current window frame. Defaults to `{ mode: 'embedded' }` when no provider is present. */
export function useWindowFrame(): WindowFrame {
  return use(WindowFrameContext)
}
