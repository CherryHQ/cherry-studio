import CodeView from '@renderer/components/CodeView'
import React, { memo } from 'react'

interface Props {
  children: string
  className?: string
  [key: string]: any
}

const CodeBlock: React.FC<Props> = ({ children, className }) => {
  const match = /language-(\w+)/.exec(className || '') || children?.includes('\n')
  const language = match?.[1] ?? 'text'

  return match ? (
    <CodeView language={language}>{children}</CodeView>
  ) : (
    <code className={className} style={{ textWrap: 'wrap' }}>
      {children}
    </code>
  )
}

export default memo(CodeBlock)
