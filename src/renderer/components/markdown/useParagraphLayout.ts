import { createContext, use } from 'react'

export const ParagraphLayoutContext = createContext(false)
export const useParagraphLayout = () => use(ParagraphLayoutContext)
