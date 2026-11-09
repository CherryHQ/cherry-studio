import { Icon } from '@iconify/react'
import { Children, type ComponentProps, isValidElement, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components, ExtraProps } from 'streamdown'

import { isKnownNavigationPath, NavigateToolInline } from '@renderer/components/chat/messages/tools/agent'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { CodeBlockTabs } from '@renderer/components/CodeBlockTabs'
import { useMarkdownCode } from '@renderer/components/markdown'
import { getExtensionByLanguage } from '@renderer/utils/codeLanguage'
import { getFileIconName } from '@renderer/utils/fileIconName'

import { useChatMarkdownRenderContext } from './ChatMarkdownRenderContext'
import CitationSup from './CitationSup'
import CodeBlock from './CodeBlock'
import { getCodeFilePath } from './codeFilePath'
import Link from './Link'
import { CODE_BLOCK_TABS_PROPERTY } from './plugins/codeBlockTabs'
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
  const code = useMarkdownCode(props.children, props.className)

  // Keep growing fences as code until Streamdown finishes rebuilding their animated spans.
  const path = code.isIncomplete ? null : getCodeFilePath(code)
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
  if (codeChild && !code.isIncomplete && getCodeFilePath(code)) return <>{children}</>
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

function ChatDivRenderer({ node, children, ...props }: MarkdownRendererProps<'div'>) {
  const { t } = useTranslation()
  const languages = node?.properties[CODE_BLOCK_TABS_PROPERTY]
  if (!Array.isArray(languages)) return <div {...props}>{children}</div>
  const blocks = Children.toArray(children).filter(isValidElement)
  const counts = new Map<string, number>()
  const items = blocks.map((content, index) => {
    const language = String(languages[index] ?? '')
    const ordinal = (counts.get(language) ?? 0) + 1
    counts.set(language, ordinal)
    const label = language || t('richEditor.toolbar.codeBlock')
    const repeated = languages.filter((value) => value === language).length > 1
    return {
      id: String(index),
      label: !language || repeated ? `${label} ${ordinal}` : label,
      icon: (
        <Icon aria-hidden icon={`material-icon-theme:${getFileIconName(`file${getExtensionByLanguage(language)}`)}`} />
      ),
      content
    }
  })
  return <CodeBlockTabs label={t('richEditor.toolbar.codeBlock')} items={items} />
}

export const CHAT_MARKDOWN_COMPONENTS = {
  div: ChatDivRenderer,
  a: ChatLinkRenderer,
  sup: ChatCitationSupRenderer,
  code: ChatCodeRenderer,
  pre: ChatPreRenderer,
  span: ChatSpanRenderer
} satisfies Partial<Components>
