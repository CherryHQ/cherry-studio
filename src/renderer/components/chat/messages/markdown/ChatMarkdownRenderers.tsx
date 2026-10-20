import type { ComponentProps, JSX } from 'react'
import type { Components, ExtraProps } from 'streamdown'

import { isKnownNavigationPath, NavigateToolInline } from '@renderer/components/chat/messages/tools/agent'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { useMarkdownCode } from '@renderer/components/markdown'
import { isInlineFilePath, normalizeInlineFilePath } from '@renderer/utils/filePath'
import { isWin } from '@renderer/utils/platform'

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

function getCodeFilePath({ text, language, isIncomplete }: ReturnType<typeof useMarkdownCode>) {
  if (isIncomplete || (language !== null && language !== 'text')) return null
  const path = normalizeInlineFilePath(text)
  return path && (isKnownNavigationPath(path) || (!isWin && isInlineFilePath(text))) ? path : null
}

function ChatCodeRenderer(props: MarkdownRendererProps<'code'>) {
  const { blockId, inlineHtmlPreviewMode, isStreaming } = useChatMarkdownRenderContext()
  const code = useMarkdownCode(props.children, props.className)

  // Keep growing fences as code until Streamdown finishes rebuilding their animated spans.
  const path = getCodeFilePath(code)
  if (path && isKnownNavigationPath(path)) return <NavigateToolInline input={{ path }} />
  if (path) return <ClickableFilePath path={path} />

  return (
    <CodeBlock
      {...(props as ComponentProps<typeof CodeBlock>)}
      blockId={blockId}
      inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      isStreaming={isStreaming}
    />
  )
}

function ChatPreRenderer({ node, children, ...props }: MarkdownRendererProps<'pre'>) {
  const child = node?.children.length === 1 ? node.children[0] : undefined
  const codeChild = child?.type === 'element' && child.tagName === 'code' ? child : undefined
  const className = codeChild?.properties.className
  const code = useMarkdownCode(children, Array.isArray(className) ? className.join(' ') : String(className ?? ''))
  // Ordinary code and raw HTML retain the pre surface's typography, whitespace and spacing.
  if (codeChild && getCodeFilePath(code)) return <>{children}</>
  return (
    <pre style={{ overflow: 'visible' }} {...props}>
      {children}
    </pre>
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
  pre: ChatPreRenderer,
  span: ChatSpanRenderer
} satisfies Partial<Components>
