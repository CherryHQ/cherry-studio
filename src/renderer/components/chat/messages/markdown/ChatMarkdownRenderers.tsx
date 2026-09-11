import { isKnownNavigationPath, NavigateToolInline } from '@renderer/components/chat/messages/tools/agent'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { MarkdownImageRenderer } from '@renderer/components/markdown'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import type { ComponentProps, CSSProperties, JSX } from 'react'
import type { Components, ExtraProps } from 'streamdown'

import { useChatMarkdownRenderContext } from './ChatMarkdownRenderContext'
import CitationSup from './CitationSup'
import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import { BARE_FILE_PATH_PROPERTY } from './plugins/rehypeBareFilePaths'
import Table from './Table'

type MarkdownRendererProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps

const PRE_STYLE: CSSProperties = { overflow: 'visible' }

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

function ChatTableRenderer(props: MarkdownRendererProps<'table'>) {
  const { blockId } = useChatMarkdownRenderContext()
  return <Table {...(props as ComponentProps<typeof Table>)} blockId={blockId} />
}

function ChatPreRenderer(props: MarkdownRendererProps<'pre'>) {
  return <pre style={PRE_STYLE} {...props} />
}

function ChatParagraphRenderer(props: MarkdownRendererProps<'p'>) {
  const hasImage = props.node?.children.some((child) => child.type === 'element' && child.tagName === 'img')
  if (hasImage) return <div {...props} />
  return <p {...props} />
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
  table: ChatTableRenderer,
  img: MarkdownImageRenderer,
  pre: ChatPreRenderer,
  p: ChatParagraphRenderer,
  span: ChatSpanRenderer,
  svg: MarkdownSvgRenderer as Components['svg']
} satisfies Partial<Components>

export const CHAT_MARKDOWN_COMPONENTS_WITH_STYLE = {
  ...CHAT_MARKDOWN_COMPONENTS,
  style: MarkdownShadowDomRenderer as Components['style']
} satisfies Partial<Components>
