import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import type { Citation } from '@renderer/types/message'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'
import type { Pluggable } from 'unified'

import { HtmlArtifactPopupHost } from '../../HtmlArtifactView'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from './ChatMarkdownRenderers'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'

interface Props {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
}

export type InlineHtmlPreviewMode = 'generating' | 'ready'

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkHtmlArtifact]
const EMPTY_CITATION_REGISTRY: ReadonlyMap<number, Citation> = new Map()
/** Streamdown's fadeIn animation wraps every word in a span; past this size that
 *  DOM amplification (and per-commit re-split) costs more than the effect is worth. */
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
/** While streaming, the latex/svg regex transforms re-scan the whole content on every
 *  commit (O(n) full-string passes). Past this size, defer them to stream completion. */
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

const ChatMarkdown: FC<Props> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'
  const hasStreamedRef = useRef(isStreaming)
  if (isStreaming) hasStreamedRef.current = true

  const plugins = useMemo(() => withChatPlugins({ singleDollarMath: mathEnableSingleDollar }), [mathEnableSingleDollar])

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    if (block.status === 'streaming' && block.content.length > MAX_STREAMING_TRANSFORM_LENGTH) {
      return block.content
    }
    const transform = (source: string) => {
      let text = removeSvgEmptyLines(processLatexBrackets(source))
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
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : undefined

  // Keep the renderer type stable when an active text tail is sealed by a
  // later process part. Historical markdown still mounts the static renderer.
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
      {inlineHtmlPreviewMode ? <HtmlArtifactPopupHost>{renderer}</HtmlArtifactPopupHost> : renderer}
    </ChatMarkdownRenderProvider>
  )
}

export default ChatMarkdown
