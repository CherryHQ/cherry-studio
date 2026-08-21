import type { MarkdownSource } from '@cherrystudio/ui'
import type { Citation } from '@renderer/types/message'
import { type FC, useMemo } from 'react'
import type { Components } from 'streamdown'

import ChatMarkdownMermaidRuntime from './ChatMarkdownMermaidRuntime'
import ChatMarkdownRuntime from './ChatMarkdownRuntime'
import { scanStandaloneHtmlArtifact } from './standaloneHtmlArtifact'
import StandaloneHtmlArtifactRenderer from './StandaloneHtmlArtifactRenderer'

export interface ChatMarkdownProps {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
}

export type InlineHtmlPreviewMode = 'generating' | 'ready'

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
      <StandaloneHtmlArtifactRenderer
        artifact={standaloneHtmlArtifact}
        block={block}
        inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      />
    )
  }

  const Runtime = MERMAID_FENCE_REGEX.test(block.content) ? ChatMarkdownMermaidRuntime : ChatMarkdownRuntime

  return <Runtime {...props} />
}

export default ChatMarkdown
