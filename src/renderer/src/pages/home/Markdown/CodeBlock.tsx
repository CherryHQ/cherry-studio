import CodeBlockView from '@renderer/components/CodeBlockView'
import React, { memo, useCallback } from 'react'

interface Props {
  children: string
  className?: string
  id?: string
  onSave?: (id: string, newContent: string) => void
  [key: string]: any
}

const CodeBlock: React.FC<Props> = ({ children, className, id, onSave }) => {
  const match = /language-([\w-+]+)/.exec(className || '') || children?.includes('\n')
  const language = match?.[1] ?? 'text'

  const handleSave = useCallback(
    (newContent: string) => {
      if (id !== undefined) {
        onSave?.(id, newContent)
      }
    },
    [id, onSave]
  )

  return match ? (
    <CodeBlockView language={language} onSave={handleSave}>
      {children}
    </CodeBlockView>
  ) : (
    <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }}>
      {children}
    </code>
  )
}

export default memo(CodeBlock)
