import { CopyIcon } from '@renderer/components/Icons'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { Tooltip } from 'antd'
import { Check } from 'lucide-react'
import React, { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  children: React.ReactNode
  node?: any
  blockId?: string
}

/**
 * 自定义 Markdown 表格组件，提供 copy 功能。
 */
const Table: React.FC<Props> = ({ children, node, blockId }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopyTable = useCallback(() => {
    const tableMarkdown = extractTableMarkdown(blockId ?? '', node?.position)
    if (!tableMarkdown) return

    navigator.clipboard
      .writeText(tableMarkdown)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch((error) => {
        window.message?.error({ content: `${t('message.copy.failed')}: ${error}`, key: 'copy-table-error' })
      })
  }, [node, blockId, t])

  return (
    <TableWrapper className="table-wrapper">
      <table>{children}</table>
      <ToolbarWrapper className="table-toolbar">
        <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
          <ToolButton role="button" aria-label={t('common.copy')} onClick={handleCopyTable}>
            {copied ? <Check size={14} color="var(--color-primary)" /> : <CopyIcon size={14} />}
          </ToolButton>
        </Tooltip>
      </ToolbarWrapper>
    </TableWrapper>
  )
}

/**
 * 从原始 Markdown 内容中提取表格源代码
 * @param blockId 消息块 ID
 * @param position 表格节点的位置信息
 * @returns 源代码
 */
export function extractTableMarkdown(blockId: string, position: any): string {
  if (!position || !blockId) return ''

  const block = messageBlocksSelectors.selectById(store.getState(), blockId)

  if (!block || !('content' in block) || typeof block.content !== 'string') return ''

  const { start, end } = position
  const lines = block.content.split('\n')

  // 提取表格对应的行（行号从1开始，数组索引从0开始）
  const tableLines = lines.slice(start.line - 1, end.line)
  return tableLines.join('\n').trim()
}

const TableWrapper = styled.div`
  position: relative;

  .table-toolbar {
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
  }
  &:hover {
    .table-toolbar {
      opacity: 1;
    }
  }
`

const ToolbarWrapper = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
`

const ToolButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  opacity: 1;
  color: var(--color-text-3);
  background-color: var(--color-background-mute);
  will-change: background-color, opacity;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

export default memo(Table)
