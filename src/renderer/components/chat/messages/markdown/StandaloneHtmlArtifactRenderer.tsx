import { type ComponentProps, lazy, Suspense } from 'react'

import type { ChatMarkdownProps } from './ChatMarkdown'
import type { StandaloneHtmlArtifact } from './standaloneHtmlArtifact'

const CodeBlock = lazy(() => import('./CodeBlock'))

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
    codeBlockProps.node = {
      position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } }
    }
  }

  return (
    <Suspense fallback={null}>
      <CodeBlock {...codeBlockProps} />
    </Suspense>
  )
}
