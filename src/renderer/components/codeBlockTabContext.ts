import { createContext } from 'react'

/** Undefined keeps the standalone header; null hides tools until this panel owns a mounted group header. */
export const CodeBlockTabContext = createContext<HTMLElement | null | undefined>(undefined)
