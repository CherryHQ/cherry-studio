import { CodeBlockView, HtmlArtifactsCard } from '@renderer/components/CodeBlockView'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { getCodeBlockId } from '@renderer/utils/markdown'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'

interface Props {
  children: string
  className?: string
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  [key: string]: any
}

const CodeBlock: React.FC<Props> = ({ children, className, node, blockId }) => {
  const match = /language-([\w-+]+)/.exec(className || '') || children?.includes('\n')
  const language = match?.[1] ?? 'text'

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  // 消息块
  const msgBlock = messageBlocksSelectors.selectById(store.getState(), blockId)
  const isStreaming = useMemo(() => msgBlock?.status === MessageBlockStatus.STREAMING, [msgBlock?.status])

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

  if (match) {
    // HTML 代码块特殊处理
    // FIXME: 感觉没有必要用 isHtmlCode 判断
    if (language === 'html') {
      return <HtmlArtifactsCard html={children} onSave={handleSave} isStreaming={isStreaming} />
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
