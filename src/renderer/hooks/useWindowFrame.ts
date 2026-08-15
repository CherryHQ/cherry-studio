import { createContext, use } from 'react'

/**
 * How the page is framed by its host window.
 * - `embedded`: rendered inside the main window below the tab bar (the default).
 * - `window`: rendered inside a detached window below its standalone title bar.
 */
export type WindowFrameMode = 'embedded' | 'window'

export interface WindowFrame {
  mode: WindowFrameMode
}

const EMBEDDED_FRAME: WindowFrame = { mode: 'embedded' }
export const WindowFrameContext = createContext<WindowFrame>(EMBEDDED_FRAME)

/** The current window frame. Defaults to `{ mode: 'embedded' }` when no provider is present. */
export function useWindowFrame(): WindowFrame {
  return use(WindowFrameContext)
}
