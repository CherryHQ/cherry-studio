import '@cherrystudio/ui/components/composites/markdown/styles'

import { defaultMarkdownPlugins, Markdown, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import type { ChatMarkdownProps } from './ChatMarkdown'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from './ChatMarkdownRenderers'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'
import { remarkLatexMath } from './plugins/remarkLatexMath'
import { remarkLiteralAutolinkFix } from './plugins/remarkLiteralAutolinkFix'

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath]
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath, remarkHtmlArtifact]
const EMPTY_CITATION_REGISTRY = new Map()
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

export interface ChatMarkdownRuntimeProps extends ChatMarkdownProps {
  createPlugins?: (singleDollarMath: boolean) => PluginConfig
}

const createDefaultPlugins = (singleDollarMath: boolean): PluginConfig => ({
  ...defaultMarkdownPlugins,
  math: withMath({ singleDollar: singleDollarMath })
})

const ChatMarkdownRuntime: FC<ChatMarkdownRuntimeProps> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations,
  createPlugins = createDefaultPlugins
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'
  const hasStreamedRef = useRef(isStreaming)
  if (isStreaming) hasStreamedRef.current = true

  const plugins = useMemo(() => createPlugins(mathEnableSingleDollar), [createPlugins, mathEnableSingleDollar])

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) return t('message.chat.completion.paused')
    if (block.status === 'streaming' && block.content.length > MAX_STREAMING_TRANSFORM_LENGTH) return block.content

    const transform = (source: string) => {
      let text = removeSvgEmptyLines(source)
      if (postProcess) text = postProcess(text)
      return text
    }
    return inlineHtmlPreviewMode
      ? transformMarkdownOutsideHtmlArtifacts(block.content, transform)
      : transform(block.content)
  }, [block.status, block.content, inlineHtmlPreviewMode, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const citationRegistry = useMemo(() => {
    if (!trustedCitations?.length) return EMPTY_CITATION_REGISTRY
    return new Map(trustedCitations.map((citation) => [citation.number, citation]))
  }, [trustedCitations])
  const chatComponents = hasStyleElement ? CHAT_MARKDOWN_COMPONENTS_WITH_STYLE : CHAT_MARKDOWN_COMPONENTS
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )
  const footnoteLabel = t('common.footnotes')
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : REMARK_PLUGINS

  const renderer = hasStreamedRef.current ? (
    <StreamingMarkdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      footnoteLabel={footnoteLabel}
      animated={isStreaming && content.length <= MAX_ANIMATED_CONTENT_LENGTH ? undefined : false}
      parseIncompleteMarkdown={isStreaming}>
      {content}
    </StreamingMarkdown>
  ) : (
    <Markdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      className={className}
      footnoteLabel={footnoteLabel}>
      {content}
    </Markdown>
  )

  return (
    <ChatMarkdownRenderProvider
      blockId={block.id}
      citationRegistry={citationRegistry}
      inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      isStreaming={isStreaming}>
      {renderer}
    </ChatMarkdownRenderProvider>
  )
}

export default ChatMarkdownRuntime
