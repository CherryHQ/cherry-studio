import { createContext, use } from 'react'

/** Ancestor wrap override so a narrow surface can wrap without the chat preference. */
export const CodeBlockWrapLinesContext = createContext(false)

export function useCodeBlockWrapLines(): boolean {
  return use(CodeBlockWrapLinesContext)
}
