import '@cherrystudio/ui/components/composites/markdown/styles'

import { defaultMarkdownPlugins, Markdown, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import type { ChatMarkdownProps } from './ChatMarkdown'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'
import { remarkLatexMath } from './plugins/remarkLatexMath'
import { remarkLiteralAutolinkFix } from './plugins/remarkLiteralAutolinkFix'
import { useChatMarkdownComponents } from './useChatMarkdownComponents'

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath]
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath, remarkHtmlArtifact]
const EMPTY_CITATION_REGISTRY = new Map()
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

/**
 * Long streaming responses (> ~2000 lines) re-parse the entire markdown tree
 * on every animation frame, and that per-frame cost grows linearly with the
 * accumulated length — saturating the main thread (CPU/RAM spike, eventual
 * crash; see issue #16934). We bound the cost with two hard-coded gates:
 *  - above THROTTLE_STREAM_LINE_THRESHOLD: re-parse markdown at most every
 *    STREAM_COMMIT_DELTA_CHARS / STREAM_COMMIT_MIN_MS instead of every frame.
 *  - above PLAIN_TEXT_STREAM_LINE_THRESHOLD: skip markdown entirely while
 *    streaming and render plain text, doing a single markdown pass on finish.
 */
const THROTTLE_STREAM_LINE_THRESHOLD = 600
const PLAIN_TEXT_STREAM_LINE_THRESHOLD = 2000
const STREAM_COMMIT_DELTA_CHARS = 2000
const STREAM_COMMIT_MIN_MS = 120

function countLines(text: string): number {
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++
  }
  return lines
}

/**
 * While streaming, returns `content` throttled so the (expensive) markdown
 * re-parse fires at most every STREAM_COMMIT_DELTA_CHARS added *or*
 * STREAM_COMMIT_MIN_MS elapsed (whichever hits first). The time gate samples
 * `performance.now()` inside the effect, so it only advances on re-renders —
 * mid-stream the visible text can therefore lag the incoming tail until a
 * large delta or a ≥MIN_MS render gap, but it self-corrects on stream end
 * (status flip → full commit), so nothing is lost. Non-streaming callers
 * always get the unthrottled content.
 */
function useThrottledStreamContent(content: string, isStreaming: boolean, enabled: boolean): string {
  const [committed, setCommitted] = useState(content)
  const lastLenRef = useRef(0)
  const lastTimeRef = useRef(0)

  useEffect(() => {
    if (!isStreaming || !enabled) {
      lastLenRef.current = content.length
      lastTimeRef.current = performance.now()
      setCommitted((prev) => (prev === content ? prev : content))
      return
    }
    const now = performance.now()
    if (
      content.length - lastLenRef.current >= STREAM_COMMIT_DELTA_CHARS ||
      now - lastTimeRef.current >= STREAM_COMMIT_MIN_MS
    ) {
      lastLenRef.current = content.length
      lastTimeRef.current = now
      setCommitted(content)
    }
  }, [content, isStreaming, enabled])

  return isStreaming && enabled ? committed : content
}

export interface ChatMarkdownRuntimeProps extends ChatMarkdownProps {
  createPlugins?: (singleDollarMath: boolean) => PluginConfig
}

const createDefaultPlugins = (singleDollarMath: boolean): PluginConfig => ({
  ...defaultMarkdownPlugins,
  math: withMath({ singleDollar: singleDollarMath })
})

// Memoized so that, while the throttle holds, an unchanged `content` does not
// re-invoke the (expensive) markdown renderer on every animation frame.
const MemoStreamingMarkdown = memo(StreamingMarkdown)
const MemoMarkdown = memo(Markdown)

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

  // Gate 2: very long responses stream as plain text to avoid the per-frame
  // markdown cost entirely. The plain-text layer is only active mid-stream;
  // once streaming completes we fall through to a single markdown render.
  const lineCount = countLines(block.content)
  const usePlainText = isStreaming && lineCount > PLAIN_TEXT_STREAM_LINE_THRESHOLD

  // Gate 1: for long-but-not-huge streaming responses, bound the per-frame
  // markdown re-parse (the throttle commits on whichever threshold hits first:
  // STREAM_COMMIT_DELTA_CHARS added or STREAM_COMMIT_MIN_MS elapsed).
  const throttleEnabled = isStreaming && !usePlainText && lineCount > THROTTLE_STREAM_LINE_THRESHOLD
  const throttledContent = useThrottledStreamContent(block.content, isStreaming, throttleEnabled)

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) return t('message.chat.completion.paused')
    if (block.status === 'streaming' && block.content.length > MAX_STREAMING_TRANSFORM_LENGTH) return block.content

    const transform = (source: string) => {
      let text = removeSvgEmptyLines(source)
      if (postProcess) text = postProcess(text)
      return text
    }
    return inlineHtmlPreviewMode
      ? transformMarkdownOutsideHtmlArtifacts(throttledContent, transform)
      : transform(throttledContent)
    // `throttledContent` (not `block.content`) is the dependency: while the
    // throttle holds, `block.content` keeps changing but the rendered output
    // must stay put so the expensive markdown re-parse is actually bounded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.status, throttledContent, inlineHtmlPreviewMode, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const citationRegistry = useMemo(() => {
    if (!trustedCitations?.length) return EMPTY_CITATION_REGISTRY
    return new Map(trustedCitations.map((citation) => [citation.number, citation]))
  }, [trustedCitations])
  const chatComponents = useChatMarkdownComponents({ blockId: block.id, hasStyleElement, isStreaming })
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )
  const footnoteLabel = t('common.footnotes')
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : REMARK_PLUGINS

  if (usePlainText) {
    return (
      <div
        data-testid="plain-text-stream"
        className="markdown overflow-x-auto"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content}
      </div>
    )
  }

  const renderer = hasStreamedRef.current ? (
    <MemoStreamingMarkdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      footnoteLabel={footnoteLabel}
      animated={isStreaming && content.length <= MAX_ANIMATED_CONTENT_LENGTH ? undefined : false}
      parseIncompleteMarkdown={isStreaming}>
      {content}
    </MemoStreamingMarkdown>
  ) : (
    <MemoMarkdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      className={className}
      footnoteLabel={footnoteLabel}>
      {content}
    </MemoMarkdown>
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
