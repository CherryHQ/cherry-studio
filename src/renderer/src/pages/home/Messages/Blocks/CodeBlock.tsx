import type { CodeMessageBlock } from '@renderer/types/newMessageTypes'
import React from 'react'

import CodeViewer from '../../CodeViewer/CodeViewer'

interface Props {
  block: CodeMessageBlock
}

const CodeBlock: React.FC<Props> = ({ block }) => {
  return <CodeViewer code={block.content} language={block.language} />
}

export default React.memo(CodeBlock)