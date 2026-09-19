import { type FC, lazy, Suspense, useMemo } from 'react'
import type { Components } from 'streamdown'

import type { MarkdownSource } from '@cherrystudio/ui'
import type { Citation } from '@renderer/types/message'

import ChatMarkdownRuntime from './ChatMarkdownRuntime'
import { scanStandaloneHtmlArtifact } from './standaloneHtmlArtifact'

export interface ChatMarkdownProps {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
  linkifyFilePaths?: boolean
}

export type InlineHtmlPreviewMode = 'generating' | 'ready'

const StandaloneHtmlArtifactRenderer = lazy(() => import('./StandaloneHtmlArtifactRenderer'))

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

  return <ChatMarkdownRuntime {...props} />
}

export default ChatMarkdown
