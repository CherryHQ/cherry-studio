import { createContext, use } from 'react'

export interface MarkdownHost {
  /** Owning surface renders relative image destinations; returns input for non-relative sources, null if resolution fails. */
  resolveImageSrc?: (src: string) => string | null
  openExternalUrl?: (url: string) => void | Promise<void>
  copyRichContent?: (
    content: { plainText: string; html: string },
    options?: { successMessage?: string }
  ) => void | Promise<void>
  exportTableAsExcel?: (data: string[][]) => boolean | Promise<boolean>
  notifySuccess?: (message: string) => void
  notifyError?: (message: string) => void
  /** Opens a schemeless Markdown link as a local file in the owning surface. */
  openFilePath?: (path: string) => void | Promise<void>
}

export const MarkdownHostContext = createContext<MarkdownHost | null>(null)

export function useMarkdownHost(): MarkdownHost {
  return use(MarkdownHostContext) ?? {}
}
