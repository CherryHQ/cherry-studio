import { createContext, use } from 'react'

export interface MarkdownHost {
  /** Opens a schemeless Markdown link as a local file in the owning surface. */
  openFilePath?: (path: string) => void | Promise<void>
}

export const MarkdownHostContext = createContext<MarkdownHost | null>(null)

export function useMarkdownHost(): MarkdownHost {
  return use(MarkdownHostContext) ?? {}
}
