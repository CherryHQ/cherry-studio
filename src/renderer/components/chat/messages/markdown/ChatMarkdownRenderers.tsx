import type { ComponentProps, JSX } from 'react'
import type { Components, ExtraProps } from 'streamdown'

import { isKnownNavigationPath, NavigateToolInline } from '@renderer/components/chat/messages/tools/agent'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'

import { useChatMarkdownRenderContext } from './ChatMarkdownRenderContext'
import CitationSup from './CitationSup'
import CodeBlock from './CodeBlock'
import Link from './Link'
import { BARE_FILE_PATH_PROPERTY } from './plugins/rehypeBareFilePaths'

type MarkdownRendererProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps

function ChatLinkRenderer(props: MarkdownRendererProps<'a'>) {
  const { citationRegistry, openFilePath } = useChatMarkdownRenderContext()
  return <Link {...props} citationRegistry={citationRegistry} openFilePath={openFilePath} />
}

function ChatCitationSupRenderer(props: MarkdownRendererProps<'sup'>) {
  const { citationRegistry } = useChatMarkdownRenderContext()
  return <CitationSup {...props} citationRegistry={citationRegistry} />
}

function ChatCodeRenderer(props: MarkdownRendererProps<'code'>) {
  const { blockId, inlineHtmlPreviewMode, isStreaming } = useChatMarkdownRenderContext()
  return (
    <CodeBlock
      {...(props as ComponentProps<typeof CodeBlock>)}
      blockId={blockId}
      inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      isStreaming={isStreaming}
    />
  )
}

function ChatSpanRenderer({ node, children, ...props }: MarkdownRendererProps<'span'>) {
  const path = node?.properties?.[BARE_FILE_PATH_PROPERTY]
  if (typeof path === 'string') {
    if (isKnownNavigationPath(path)) return <NavigateToolInline input={{ path }} />
    return <ClickableFilePath path={path} displayName={path} preserveWrappingPunctuation />
  }
  return <span {...props}>{children}</span>
}

export const CHAT_MARKDOWN_COMPONENTS = {
  a: ChatLinkRenderer,
  sup: ChatCitationSupRenderer,
  code: ChatCodeRenderer,
  span: ChatSpanRenderer
} satisfies Partial<Components>
