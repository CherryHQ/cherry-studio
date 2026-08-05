import type { Citation } from '@renderer/types/message'
import { createContext, type ReactNode, use, useMemo } from 'react'

import type { InlineHtmlPreviewMode } from './ChatMarkdown'

interface ChatMarkdownRenderContextValue {
  blockId: string
  citationRegistry: ReadonlyMap<number, Citation>
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  isStreaming: boolean
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
  isStreaming
}: ChatMarkdownRenderProviderProps) {
  const value = useMemo(
    () => ({ blockId, citationRegistry, inlineHtmlPreviewMode, isStreaming }),
    [blockId, citationRegistry, inlineHtmlPreviewMode, isStreaming]
  )

  return <ChatMarkdownRenderContext value={value}>{children}</ChatMarkdownRenderContext>
}

export function useChatMarkdownRenderContext(): ChatMarkdownRenderContextValue {
  const context = use(ChatMarkdownRenderContext)
  if (!context) throw new Error('useChatMarkdownRenderContext must be used within ChatMarkdownRenderProvider')
  return context
}
