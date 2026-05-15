import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CopyIcon } from '@renderer/components/Icons'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check, FileSpreadsheet } from 'lucide-react'
import MarkdownIt from 'markdown-it'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Node } from 'unist'

import { useOptionalMessageListActions } from '../MessageListProvider'
import { useMarkdownBlockContext } from './Markdown'

const logger = loggerService.withContext('Table')

interface Props {
  children: React.ReactNode
  node?: Omit<Node, 'type'>
  blockId?: string
}

/**
 * 自定义 Markdown 表格组件，提供 copy 功能。
 */
const Table: React.FC<Props> = ({ children, node, blockId }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const mdCtx = useMarkdownBlockContext()
  const actions = useOptionalMessageListActions()
  const canCopyTable = !!actions?.copyRichContent
  const canExportExcel = !!actions?.exportTableAsExcel

  const handleCopyTable = useCallback(async () => {
    const tableMarkdown = extractTableMarkdown(blockId ?? '', node?.position, mdCtx?.content)
    if (!tableMarkdown) {
      actions?.notifyError?.(t('message.error.table.invalid'))
      return
    }

    try {
      const tableHtml = convertMarkdownTableToHtml(tableMarkdown)
      await actions?.copyRichContent?.(
        {
          plainText: tableMarkdown,
          html: tableHtml
        },
        { successMessage: t('message.copied') }
      )
      setCopied(true)
    } catch (error) {
      logger.error('Failed to copy table to clipboard', { error })
      actions?.notifyError?.(t('message.copy.failed'))
    }
  }, [actions, blockId, node?.position, setCopied, t, mdCtx?.content])

  const handleExportExcel = useCallback(async () => {
    const tableMarkdown = extractTableMarkdown(blockId ?? '', node?.position, mdCtx?.content)
    if (!tableMarkdown) {
      actions?.notifyError?.(t('message.error.table.invalid'))
      return
    }

    try {
      const result = await actions?.exportTableAsExcel?.(tableMarkdown)
      if (result) {
        actions?.notifySuccess?.(t('message.success.excel.export'))
      }
    } catch (error) {
      logger.error('Failed to export table to Excel', { error })
      actions?.notifyError?.(t('message.error.excel.export'))
    }
  }, [actions, blockId, node?.position, t, mdCtx?.content])

  return (
    <div className="table-wrapper relative hover:[&_.table-toolbar]:opacity-100">
      <table>{children}</table>
      {(canCopyTable || canExportExcel) && (
        <div className="table-toolbar transform-[translateZ(0)] absolute top-2 right-2 z-10 flex gap-1 rounded opacity-0 transition-opacity duration-200 ease-in-out will-change-[opacity]">
          {canCopyTable && (
            <Tooltip content={t('common.copy')} delay={800}>
              <div
                className="flex h-6 w-6 cursor-pointer select-none items-center justify-center rounded bg-accent text-foreground-muted opacity-100 transition-all duration-200 ease-in-out will-change-[background-color,opacity] hover:bg-muted"
                role="button"
                aria-label={t('common.copy')}
                onClick={handleCopyTable}>
                {copied ? <Check size={14} color="var(--color-primary)" /> : <CopyIcon size={14} />}
              </div>
            </Tooltip>
          )}
          {canExportExcel && (
            <Tooltip content={t('common.export.excel')} delay={800}>
              <div
                className="flex h-6 w-6 cursor-pointer select-none items-center justify-center rounded bg-accent text-foreground-muted opacity-100 transition-all duration-200 ease-in-out will-change-[background-color,opacity] hover:bg-muted"
                role="button"
                aria-label={t('common.export.excel')}
                onClick={handleExportExcel}>
                <FileSpreadsheet size={14} />
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 从原始 Markdown 内容中提取表格源代码
 * @param blockId 消息块 ID
 * @param position 表格节点的位置信息
 * @param markdownContent 原始 markdown 内容（来自 MarkdownBlockContext）
 * @returns 源代码
 */
export function extractTableMarkdown(_blockId: string, position: any, markdownContent?: string): string {
  if (!position || !markdownContent) return ''

  const { start, end } = position
  const lines = markdownContent.split('\n')

  // 提取表格对应的行（行号从1开始，数组索引从0开始）
  const tableLines = lines.slice(start.line - 1, end.line)
  return tableLines.join('\n').trim()
}

function convertMarkdownTableToHtml(markdownTable: string): string {
  const md = new MarkdownIt({
    html: true,
    breaks: false,
    linkify: false
  })

  return md.render(markdownTable)
}

export default memo(Table)
