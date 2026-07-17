import { createContext, type ReactNode, use } from 'react'

/**
 * Injection surface that a host (e.g. the chat message list) provides to the
 * shared markdown renderer. Every field is optional: off-host the renderer
 * degrades to a plain, action-less presentation.
 *
 * Signatures are inlined (not `Pick`ed from the chat message types) so this
 * shared module stays domain-neutral — nothing here may import the chat layer.
 */
export interface MarkdownHost {
  /** Render code fences with the fancy Shiki block (default `true` off-host). */
  codeFancyBlock?: boolean
  /** Suppress in-place edit affordances (e.g. code-block save). */
  readonly?: boolean
  /** Persist an edited code block back to its owning block. */
  saveCodeBlock?: (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => void | Promise<void>
  /** Open an external URL through the host (used by citation cards). */
  openExternalUrl?: (url: string) => void | Promise<void>
  /** Copy rich (html + plain) content to the clipboard. */
  copyRichContent?: (
    content: { plainText: string; html: string; customFormats?: Record<string, string> },
    options?: { successMessage?: string }
  ) => void | Promise<void>
  /** Export a markdown table to an Excel file; returns whether it succeeded. */
  exportTableAsExcel?: (markdown: string) => boolean | Promise<boolean>
  notifySuccess?: (message: string) => void
  notifyError?: (message: string) => void
  /** Open a workspace file path (e.g. show it in the artifact right pane). Used by
   *  file-path markdown links, which keep their own text but route clicks here. */
  openFilePath?: (path: string) => void
  /** Render an inline file path as an interactive element (host-specific). */
  renderInlineFilePath?: (path: string) => ReactNode
}

export const MarkdownHostContext = createContext<MarkdownHost | null>(null)

/** Neutral fallback when no host is mounted (off-chat previews). */
const DEFAULT_MARKDOWN_HOST: MarkdownHost = { codeFancyBlock: true }

/** Non-throwing accessor: returns the mounted host, or a neutral default. */
export function useMarkdownHost(): MarkdownHost {
  return use(MarkdownHostContext) ?? DEFAULT_MARKDOWN_HOST
}
