import { createContext, use } from 'react'

/**
 * Carries the raw markdown source to sub-components rendered inside a
 * `<Markdown>` (e.g. `Table` needs the original markdown to support
 * "copy as markdown"). Renderer-level chat components consume this via
 * `useMarkdownBlockContext`.
 */
export interface MarkdownBlockContextValue {
  content: string
}

export const MarkdownBlockContext = createContext<MarkdownBlockContextValue | null>(null)

export function useMarkdownBlockContext(): MarkdownBlockContextValue | null {
  return use(MarkdownBlockContext)
}
