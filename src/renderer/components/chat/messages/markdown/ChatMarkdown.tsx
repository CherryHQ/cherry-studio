import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

import { useChatMarkdownComponents } from './useChatMarkdownComponents'

interface Props {
  block: MarkdownSource
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
}

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

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

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
      // Returned value is `content` directly in this branch, so skip the
      // state write unless it actually changed (avoids a needless re-render).
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

const ChatMarkdown: FC<Props> = ({ block, postProcess, className, components }) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'
  const hasStreamedRef = useRef(isStreaming)
  if (isStreaming) hasStreamedRef.current = true

  const plugins = useMemo(() => withChatPlugins({ singleDollarMath: mathEnableSingleDollar }), [mathEnableSingleDollar])

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
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    let text = removeSvgEmptyLines(processLatexBrackets(usePlainText ? block.content : throttledContent))
    if (postProcess) text = postProcess(text)
    return text
  }, [block.status, block.content, throttledContent, usePlainText, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const chatComponents = useChatMarkdownComponents({ blockId: block.id, hasStyleElement, isStreaming })
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )

  const footnoteLabel = t('common.footnotes')

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

  // Keep the renderer type stable when an active text tail is sealed by a
  // later process part. Historical markdown still mounts the static renderer.
  if (hasStreamedRef.current) {
    return (
      <StreamingMarkdown
        id={block.id}
        plugins={plugins}
        components={mergedComponents}
        footnoteLabel={footnoteLabel}
        animated={isStreaming ? undefined : false}
        parseIncompleteMarkdown={isStreaming}>
        {content}
      </StreamingMarkdown>
    )
  }
  return (
    <Markdown
      id={block.id}
      plugins={plugins}
      components={mergedComponents}
      className={className}
      footnoteLabel={footnoteLabel}>
      {content}
    </Markdown>
  )
}

export default ChatMarkdown
