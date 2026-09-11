import { type FC, lazy, Suspense, useMemo } from 'react'
import type { Components } from 'streamdown'

import type { MarkdownSource } from '@cherrystudio/ui'
import type { Citation } from '@renderer/types/message'

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
// Deliberately permissive about block-quote/list prefixes and info strings: a false positive only
// loads the Mermaid runtime needlessly, a false negative renders a diagram as a plain code block.
const MERMAID_FENCE_REGEX = /(?:^|\n)[ \t>]*(?:[*+-][ \t]+|\d{1,9}[.)][ \t]+)?(?:`{3,}|~{3,})[ \t]*mermaid\b/i

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
