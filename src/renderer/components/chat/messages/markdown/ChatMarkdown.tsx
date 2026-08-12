import type { MarkdownSource } from '@cherrystudio/ui'
import type { Citation } from '@renderer/types/message'
import { type FC, lazy, Suspense, useMemo } from 'react'
import type { Components } from 'streamdown'

import { scanStandaloneHtmlArtifact } from './standaloneHtmlArtifact'

export interface ChatMarkdownProps {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
}

export type InlineHtmlPreviewMode = 'generating' | 'ready'

const ChatMarkdownRuntime = lazy(() => import('./ChatMarkdownRuntime'))
const ChatMarkdownMermaidRuntime = lazy(() => import('./ChatMarkdownMermaidRuntime'))
const StandaloneHtmlArtifactRenderer = lazy(() => import('./StandaloneHtmlArtifactRenderer'))
const MERMAID_FENCE_REGEX = /(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,})mermaid(?:[ \t]*\n|[ \t]*$)/i

const ChatMarkdown: FC<ChatMarkdownProps> = (props) => {
  const { block, inlineHtmlPreviewMode } = props
  const standaloneHtmlArtifact = useMemo(
    () => (inlineHtmlPreviewMode ? scanStandaloneHtmlArtifact(block.content, block.status === 'streaming') : undefined),
    [block.content, block.status, inlineHtmlPreviewMode]
  )

  if (standaloneHtmlArtifact && inlineHtmlPreviewMode) {
    return (
      <Suspense fallback={null}>
        <StandaloneHtmlArtifactRenderer
          artifact={standaloneHtmlArtifact}
          block={block}
          inlineHtmlPreviewMode={inlineHtmlPreviewMode}
        />
      </Suspense>
    )
  }

  const Runtime = MERMAID_FENCE_REGEX.test(block.content) ? ChatMarkdownMermaidRuntime : ChatMarkdownRuntime

  return (
    <Suspense
      fallback={
        <div className={props.className} style={{ whiteSpace: 'pre-wrap' }}>
          {block.content}
        </div>
      }>
      <Runtime {...props} />
    </Suspense>
  )
}

export default ChatMarkdown
