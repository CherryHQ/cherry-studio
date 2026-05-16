import { CodeBlockView, HtmlArtifactsCard } from '@renderer/components/CodeBlockView'
import { ARTIFACT_EXT } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { ClickableFilePath } from '@renderer/pages/home/Messages/Tools/MessageAgentTools/ClickableFilePath'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { getCodeBlockId, isOpenFenceBlock } from '@renderer/utils/markdown'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'

const artifactExtRe = new RegExp(`${ARTIFACT_EXT}$`, 'i')

function isLikelyFilePath(text: string): boolean {
  if (!text) return false
  // Exclude URLs
  if (/^https?:\/\//i.test(text)) return false
  // Must not contain whitespace
  if (/\s/.test(text)) return false
  // Must have a recognizable file extension
  if (!artifactExtRe.test(text)) return false
  // Must contain at least one directory separator
  if (!text.includes('/') && !text.includes('\\')) return false
  // Must not end with a separator
  if (/[/\\]$/.test(text)) return false
  return true
}

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
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const language = useMemo(() => {
    return detectedLanguage !== 'xml'
      ? detectedLanguage
      : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(children)
        ? 'svg'
        : detectedLanguage
  }, [children, detectedLanguage])
  const { codeFancyBlock } = useSettings()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  // 消息块
  const msgBlock = messageBlocksSelectors.selectById(store.getState(), blockId)
  const isStreaming = useMemo(() => msgBlock?.status === MessageBlockStatus.STREAMING, [msgBlock?.status])

  const handleSave = useCallback(
    (newContent: string) => {
      if (id !== undefined) {
        void EventEmitter.emit(EVENT_NAMES.EDIT_CODE_BLOCK, {
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
        const isOpenFence = isOpenFenceBlock(children?.length, languageMatch?.[1]?.length, node?.position)
        return <HtmlArtifactsCard html={children} onSave={handleSave} isStreaming={isStreaming && isOpenFence} />
      }
    }

    return (
      <CodeBlockView language={language} onSave={handleSave}>
        {children}
      </CodeBlockView>
    )
  }

  // Detect inline code that looks like a file path (absolute or relative)
  // Supports Unix paths (/Users/foo/bar.md), Windows paths (C:\Users\foo\bar.md),
  // and relative paths (output/黄金价格分析报告.md, ./file.html)
  if (typeof children === 'string' && isLikelyFilePath(children)) {
    return (
      <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }}>
        <ClickableFilePath path={children} />
      </code>
    )
  }

  return (
    <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }}>
      {children}
    </code>
  )
}

export default memo(CodeBlock)
