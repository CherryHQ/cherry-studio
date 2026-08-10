import { Button } from '@cherrystudio/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ProgressBar } from './ProgressBar'
import { TRACE_ROW_GRID, TRACE_ROW_HEIGHT, type TraceNode } from './traceNode'
import type { TraceTreeModel } from './TraceTreeModel'

const TRACE_OVERSCAN = 8
const TRACE_SCROLL_END_THRESHOLD = 8

interface TraceTreeProps {
  model: TraceTreeModel
  revision: number
  handleClick: (nodeId: string) => void
  handleToggle: (nodeId: string) => void
}

interface ScrollAnchor {
  id: string
  offset: number
}

export const convertTime = (time: number | null): string => {
  if (time == null) {
    return ''
  }
  if (time > 100000) {
    return `${(time / 1000).toFixed(0)}s`
  }
  if (time > 10000) {
    return `${(time / 1000).toFixed(1)}s`
  }
  if (time > 1000) {
    return `${(time / 1000).toFixed(2)}s`
  }
  if (time > 100) {
    return `${time.toFixed(0)}ms`
  }
  if (time > 10) {
    return `${time.toFixed(1)}ms`
  }
  return time.toFixed(2) + 'ms'
}

export function isTraceScrollAtBottom(element: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= TRACE_SCROLL_END_THRESHOLD
}

export function getAnchoredTraceScrollTop(anchor: ScrollAnchor, nextIndex: number): number {
  return nextIndex * TRACE_ROW_HEIGHT + anchor.offset
}

const TraceTree = ({ model, revision, handleClick, handleToggle }: TraceTreeProps) => {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const isAtBottomRef = useRef(true)
  const previousRevisionRef = useRef(revision)
  const getItemKey = useCallback((index: number) => model.visibleRows[index]?.id ?? index, [model])
  const rowVirtualizer = useVirtualizer({
    count: model.visibleRows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => TRACE_ROW_HEIGHT,
    getItemKey,
    overscan: TRACE_OVERSCAN
  })

  const captureScrollState = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    isAtBottomRef.current = isTraceScrollAtBottom(scroller)
    const topIndex = Math.min(Math.floor(scroller.scrollTop / TRACE_ROW_HEIGHT), model.visibleRows.length - 1)
    const row = topIndex >= 0 ? model.visibleRows[topIndex] : undefined
    anchorRef.current = row ? { id: row.id, offset: scroller.scrollTop - topIndex * TRACE_ROW_HEIGHT } : null
  }, [model])

  useLayoutEffect(() => {
    const mutation = model.lastMutation
    let followedAppend = false
    if (previousRevisionRef.current !== revision && mutation.structureChanged) {
      const shouldFollowAppend =
        mutation.kind === 'incremental' &&
        mutation.visibleCount > mutation.previousVisibleCount &&
        isAtBottomRef.current

      if (shouldFollowAppend && mutation.visibleCount > 0) {
        rowVirtualizer.scrollToIndex(mutation.visibleCount - 1, { align: 'end' })
        followedAppend = true
        isAtBottomRef.current = true
      } else {
        const anchor = anchorRef.current
        const nextIndex = anchor ? model.getVisibleIndex(anchor.id) : undefined
        const scroller = scrollerRef.current
        if (anchor && nextIndex !== undefined && scroller) {
          scroller.scrollTop = getAnchoredTraceScrollTop(anchor, nextIndex)
        }
      }
    }

    previousRevisionRef.current = revision
    if (!followedAppend) captureScrollState()
  }, [captureScrollState, model, revision, rowVirtualizer])

  return (
    <div
      data-testid="trace-table"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border-subtle bg-card">
      <div className={`${TRACE_ROW_GRID} z-[2] w-full shrink-0 border-border border-b-[0.5px] bg-card`}>
        <div className="flex h-8 min-w-0 items-center bg-background-subtle px-2 text-left font-medium text-muted-foreground text-xs max-[520px]:px-1">
          <span tabIndex={0} className="min-w-0 truncate">
            {t('trace.name')}
          </span>
        </div>
        <div className="flex h-8 min-w-0 items-center justify-center bg-background-subtle px-2 text-center font-medium text-muted-foreground text-xs max-[520px]:px-1">
          <span className="min-w-0 truncate">{t('trace.spendTime')}</span>
        </div>
        <div className="flex h-8 min-w-0 items-center bg-background-subtle px-2 max-[520px]:px-1" />
      </div>
      <div
        ref={scrollerRef}
        data-testid="trace-list-scroll"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={captureScrollState}>
        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = model.visibleRows[virtualRow.index]
            if (!row) return null
            const node = model.getNode(row.id)
            const rootNode = model.getNode(row.rootId)
            if (!node || !rootNode) return null

            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full"
                style={{ height: TRACE_ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}>
                <TraceTreeRow
                  node={node}
                  rootNode={rootNode}
                  depth={row.depth}
                  isExpanded={model.isExpanded(node.id)}
                  handleClick={handleClick}
                  handleToggle={handleToggle}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const TraceTreeRow = memo(function TraceTreeRow({
  node,
  rootNode,
  depth,
  isExpanded,
  handleClick,
  handleToggle
}: {
  node: TraceNode
  rootNode: TraceNode
  depth: number
  isExpanded: boolean
  handleClick: (nodeId: string) => void
  handleToggle: (nodeId: string) => void
}) {
  const hasChildren = node.childIds.length > 0
  const rootEndTime = rootNode.endTime || Date.now()
  const nodeEndTime = node.endTime || rootEndTime
  const rootDuration = rootEndTime - rootNode.startTime
  const usedTime = convertTime(nodeEndTime - node.startTime)
  const start = rootDuration === 0 ? 0 : ((node.startTime - rootNode.startTime) * 100) / rootDuration
  const percent = rootDuration === 0 ? 0 : ((nodeEndTime - node.startTime) * 100) / rootDuration

  return (
    <div
      data-trace-row={node.id}
      className={`${TRACE_ROW_GRID} h-8 w-full border-border-subtle border-b-[0.5px] px-2 text-xs hover:cursor-pointer hover:bg-accent max-[520px]:px-1 [&>div]:min-w-0`}
      onClick={(event) => {
        event.preventDefault()
        handleClick(node.id)
      }}>
      <div className="min-w-0 text-left" style={{ paddingLeft: `${depth * 4 + 2}px` }}>
        <div className="flex min-w-0 flex-row items-center gap-1.5">
          <Button
            aria-label="Toggle"
            aria-expanded={isExpanded}
            variant="ghost"
            size="icon-sm"
            className="h-6 w-4 shrink-0 p-0"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              handleToggle(node.id)
            }}
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </Button>
          <span
            role="button"
            tabIndex={0}
            className={`${node.status === 'ERROR' ? 'text-destructive' : 'text-foreground'} min-w-0 flex-1 cursor-pointer select-none [overflow-wrap:anywhere]`}>
            {node.name}
          </span>
        </div>
      </div>
      <div className="min-w-0 whitespace-nowrap text-center">
        <span>{usedTime}</span>
      </div>
      <div className="min-w-0 px-1 py-2 text-center">
        <ProgressBar progress={Math.max(percent, 5)} start={start} />
      </div>
    </div>
  )
})

export default TraceTree
