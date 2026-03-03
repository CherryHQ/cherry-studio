import { CodeBlockView, HtmlArtifactsCard } from '@renderer/components/CodeBlockView'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getCodeBlockId } from '@renderer/utils/markdown'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

interface Props {
  children: string
  className?: string
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  [key: string]: any
}

const CodeBlock: React.FC<Props> = ({ children, className, node, blockId }) => {
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = children?.includes('\n')
  const language = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const { codeFancyBlock } = useSettings()
  const isIncomplete = useIsCodeFenceIncomplete()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  const handleSave = useCallback(
    (newContent: string) => {
      if (id !== undefined) {
        EventEmitter.emit(EVENT_NAMES.EDIT_CODE_BLOCK, {
          msgBlockId: blockId,
          codeBlockId: id,
          newContent
        })
      }
    },
    [blockId, id]
  )

  if (language !== null) {
    // Fancy code block
    if (codeFancyBlock) {
      if (language === 'html') {
        return <HtmlArtifactsCard html={children} onSave={handleSave} isStreaming={isIncomplete} />
      }
    }

    return (
      <CodeBlockView language={language} onSave={handleSave}>
        {children}
      </CodeBlockView>
    )
  }

  return (
    <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }}>
      {children}
    </code>
  )
}

export default memo(CodeBlock)
