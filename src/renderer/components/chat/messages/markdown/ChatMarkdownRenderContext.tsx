import type { Citation } from '@renderer/types/message'
import { createContext, type ReactNode, use, useMemo } from 'react'

import type { InlineHtmlPreviewMode } from './ChatMarkdown'

interface ChatMarkdownRenderContextValue {
  blockId: string
  citationRegistry: ReadonlyMap<number, Citation>
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  isStreaming: boolean
  /** When set, schemeless markdown links that resolve to workspace files route here. */
  openFilePath?: (path: string) => void | Promise<void>
}

interface ChatMarkdownRenderProviderProps extends ChatMarkdownRenderContextValue {
  children: ReactNode
}

const ChatMarkdownRenderContext = createContext<ChatMarkdownRenderContextValue | null>(null)

export function ChatMarkdownRenderProvider({
  blockId,
  children,
  citationRegistry,
  inlineHtmlPreviewMode,
  isStreaming,
  openFilePath
}: ChatMarkdownRenderProviderProps) {
  const value = useMemo(
    () => ({ blockId, citationRegistry, inlineHtmlPreviewMode, isStreaming, openFilePath }),
    [blockId, citationRegistry, inlineHtmlPreviewMode, isStreaming, openFilePath]
  )

  return <ChatMarkdownRenderContext value={value}>{children}</ChatMarkdownRenderContext>
}

export function useChatMarkdownRenderContext(): ChatMarkdownRenderContextValue {
  const context = use(ChatMarkdownRenderContext)
  if (!context) throw new Error('useChatMarkdownRenderContext must be used within ChatMarkdownRenderProvider')
  return context
}
