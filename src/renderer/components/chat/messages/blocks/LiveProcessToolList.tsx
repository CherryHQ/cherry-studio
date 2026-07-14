import { Button } from '@cherrystudio/ui'
import { formatFileSize } from '@renderer/utils/file'
import React, { useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getEffectiveStatus, type ToolStatus } from '../tools/shared/GenericTools'
import ToolHeader from '../tools/ToolHeader'
import { isToolPartAwaitingApproval, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import { usePartsMap } from './MessagePartsContext'

const TOOL_DETAIL_MAX_LENGTH = 12_000

interface Props {
  items: ToolRenderItem[]
  onAfterCollapse?: () => void
  onBeforeExpand: () => void
  expandedToolId?: string | null
  onExpandedToolIdChange?: (toolCallId: string | null) => void
}

function getToolCallId(item: ToolRenderItem): string {
  return item.toolResponse.toolCallId ?? item.toolResponse.id ?? item.id
}

function getDisplayStatus(toolResponse: ToolResponseLike, isWaiting: boolean): ToolStatus {
  if (toolResponse.status === 'error' || toolResponse.response?.isError === true) return 'error'
  return getEffectiveStatus(toolResponse.status, isWaiting)
}

function serializeDetailValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''

  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(
        value,
        (_key, entry: unknown) => {
          if (typeof entry === 'bigint') return entry.toString()
          if (typeof entry !== 'object' || entry === null) return entry
          if (seen.has(entry)) return '[Circular]'
          seen.add(entry)
          return entry
        },
        2
      ) ?? String(value)
    )
  } catch {
    try {
      return String(value)
    } catch {
      return ''
    }
  }
}

function getDetailText(value: unknown): { text: string; isTruncated: boolean; originalLength: number } {
  const serialized = serializeDetailValue(value)
  const originalLength = serialized.length
  if (originalLength <= TOOL_DETAIL_MAX_LENGTH) {
    return { text: serialized, isTruncated: false, originalLength }
  }

  return {
    text: serialized.slice(0, TOOL_DETAIL_MAX_LENGTH),
    isTruncated: true,
    originalLength
  }
}

function ToolDetailSection({ label, value }: { label: string; value: unknown }) {
  const { t } = useTranslation()
  const detail = useMemo(() => getDetailText(value), [value])
  if (!detail.text) return null

  return (
    <section className="flex min-w-0 flex-col gap-1" data-truncated={detail.isTruncated || undefined}>
      <h4 className="m-0 font-medium text-[12px] text-foreground-muted leading-5">{label}</h4>
      <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] text-foreground-secondary leading-5">
        {detail.text}
      </pre>
      {detail.isTruncated && (
        <span className="text-[11px] text-foreground-muted leading-4">
          {t('message.tools.truncated', { size: formatFileSize(detail.originalLength) })}
        </span>
      )}
    </section>
  )
}

const LiveProcessToolRow = React.memo(function LiveProcessToolRow({
  expanded,
  isWaiting,
  item,
  onExpandedChange
}: {
  expanded: boolean
  isWaiting: boolean
  item: ToolRenderItem
  onExpandedChange: (toolCallId: string, expanded: boolean) => void
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const toolResponse = item.toolResponse
  const toolCallId = getToolCallId(item)
  const status = getDisplayStatus(toolResponse, isWaiting)
  const hasError = status === 'error'
  const args = toolResponse.partialArguments ?? toolResponse.arguments
  const hasDetails = args !== undefined || toolResponse.response !== undefined
  const disclosureLabel = `${t(expanded ? 'common.collapse' : 'common.expand')}: ${toolResponse.tool.name}`

  return (
    <div
      className="group/tool w-full min-w-0"
      data-testid="live-process-tool"
      data-tool-call-id={toolCallId}
      data-tool-status={status}
      data-tool-error={hasError || undefined}>
      <div className="flex min-h-7 min-w-0 items-center py-0.5">
        {hasDetails ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={disclosureLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            data-testid="live-process-tool-trigger"
            className="h-auto min-h-7 w-full min-w-0 flex-1 justify-start overflow-hidden rounded bg-transparent px-0 py-0.5 text-left shadow-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 focus-visible:ring-0"
            onClick={() => onExpandedChange(toolCallId, expanded)}>
            <div className="w-full min-w-0 overflow-hidden">
              <ToolHeader toolResponse={toolResponse} variant="collapse-label" status={status} hasError={hasError} />
            </div>
          </Button>
        ) : (
          <div className="w-full min-w-0 overflow-hidden">
            <ToolHeader toolResponse={toolResponse} variant="collapse-label" status={status} hasError={hasError} />
          </div>
        )}
      </div>
      <div id={contentId} hidden={!expanded}>
        {expanded && hasDetails && (
          <div
            data-testid="live-process-tool-content"
            className="ml-1 flex min-w-0 flex-col gap-2.5 border-border-subtle border-l py-1 pl-3">
            <ToolDetailSection label={t('message.tools.sections.args')} value={args} />
            <ToolDetailSection label={t('message.tools.sections.output')} value={toolResponse.response} />
          </div>
        )}
      </div>
    </div>
  )
})

/**
 * A live-only tool list with one user-controlled detail disclosure. It renders
 * generic text instead of mounting the standalone tool cards, so tool status
 * updates cannot auto-expand, auto-collapse, or introduce another scroller.
 */
const LiveProcessToolList = React.memo(function LiveProcessToolList({
  items,
  onAfterCollapse,
  onBeforeExpand,
  expandedToolId,
  onExpandedToolIdChange
}: Props) {
  const partsMap = usePartsMap()
  const [internalExpandedToolId, setInternalExpandedToolId] = useState<string | null>(null)
  const isControlled = expandedToolId !== undefined
  const currentExpandedToolId = isControlled ? expandedToolId : internalExpandedToolId

  const handleExpandedChange = useCallback(
    (toolCallId: string, expanded: boolean) => {
      if (!expanded) onBeforeExpand()
      const nextExpandedToolId = expanded ? null : toolCallId
      if (!isControlled) setInternalExpandedToolId(nextExpandedToolId)
      onExpandedToolIdChange?.(nextExpandedToolId)
      if (expanded) onAfterCollapse?.()
    },
    [isControlled, onAfterCollapse, onBeforeExpand, onExpandedToolIdChange]
  )

  return (
    <div data-testid="live-process-tool-list" className="flex w-full min-w-0 flex-col gap-0.5">
      {items.map((item) => {
        const toolCallId = getToolCallId(item)
        const expanded = currentExpandedToolId === toolCallId
        const isWaiting = item.toolResponse.status === 'pending' && isToolPartAwaitingApproval(partsMap, toolCallId)

        return (
          <LiveProcessToolRow
            key={toolCallId}
            item={item}
            expanded={expanded}
            isWaiting={isWaiting}
            onExpandedChange={handleExpandedChange}
          />
        )
      })}
    </div>
  )
})

export default LiveProcessToolList
