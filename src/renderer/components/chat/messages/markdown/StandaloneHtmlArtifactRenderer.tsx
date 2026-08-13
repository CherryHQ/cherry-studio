import type { ComponentProps } from 'react'

import type { ChatMarkdownProps } from './ChatMarkdown'
import CodeBlock from './CodeBlock'
import type { StandaloneHtmlArtifact } from './standaloneHtmlArtifact'

interface Props {
  artifact: StandaloneHtmlArtifact
  block: ChatMarkdownProps['block']
  inlineHtmlPreviewMode: NonNullable<ChatMarkdownProps['inlineHtmlPreviewMode']>
}

export default function StandaloneHtmlArtifactRenderer({ artifact, block, inlineHtmlPreviewMode }: Props) {
  const codeBlockProps: ComponentProps<typeof CodeBlock> = {
    blockId: block.id,
    className: 'language-html',
    inlineHtmlPreviewMode,
    isStreaming: block.status === 'streaming',
    children: artifact.html
  }

  if (artifact.source === 'fence') {
    codeBlockProps.node = { position: { start: artifact.start, end: artifact.start } }
  }

  return <CodeBlock {...codeBlockProps} />
}
