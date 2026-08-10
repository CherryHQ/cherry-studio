import { Button } from '@cherrystudio/ui'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type KeyboardEvent, memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
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

function getTraceTreeItemId(nodeId: string): string {
  return `trace-tree-item-${encodeURIComponent(nodeId)}`
}

const TraceTree = ({ model, revision, handleClick, handleToggle }: TraceTreeProps) => {
  const { t } = useTranslation()
  const expandLabel = t('common.expand')
  const collapseLabel = t('common.collapse')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const isAtBottomRef = useRef(true)
  const previousRevisionRef = useRef(revision)
  const [requestedActiveNodeId, setRequestedActiveNodeId] = useState<string | null>(
    () => model.visibleRows[0]?.id ?? null
  )
  const activeNodeId =
    requestedActiveNodeId && model.getVisibleIndex(requestedActiveNodeId) !== undefined
      ? requestedActiveNodeId
      : (model.visibleRows[0]?.id ?? null)
  const activeIndex = activeNodeId ? model.getVisibleIndex(activeNodeId) : undefined
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeIndex === undefined || indexes.includes(activeIndex)) return indexes
      return [...indexes, activeIndex].sort((left, right) => left - right)
    },
    [activeIndex]
  )
  const rowVirtualizer = useVirtualizer({
    count: model.visibleRows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => TRACE_ROW_HEIGHT,
    getItemKey: model.virtualItemKey,
    rangeExtractor,
    overscan: TRACE_OVERSCAN
  })

  const focusNode = useCallback((nodeId: string) => {
    setRequestedActiveNodeId(nodeId)
    scrollerRef.current?.focus()
  }, [])

  const selectNode = useCallback(
    (nodeId: string) => {
      focusNode(nodeId)
      handleClick(nodeId)
    },
    [focusNode, handleClick]
  )

  const toggleNode = useCallback(
    (nodeId: string) => {
      focusNode(nodeId)
      handleToggle(nodeId)
    },
    [focusNode, handleToggle]
  )

  const moveActiveToIndex = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, model.visibleRows.length - 1))
      const nextRow = model.visibleRows[nextIndex]
      if (!nextRow) return
      setRequestedActiveNodeId(nextRow.id)
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' })
    },
    [model, rowVirtualizer]
  )

  const handleTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || !activeNodeId) return

      const activeIndex = model.getVisibleIndex(activeNodeId)
      const activeRow = activeIndex === undefined ? undefined : model.visibleRows[activeIndex]
      const activeNode = model.getNode(activeNodeId)
      if (activeIndex === undefined || !activeRow || !activeNode) return

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveActiveToIndex(activeIndex + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveActiveToIndex(activeIndex - 1)
          break
        case 'Home':
          event.preventDefault()
          moveActiveToIndex(0)
          break
        case 'End':
          event.preventDefault()
          moveActiveToIndex(model.visibleRows.length - 1)
          break
        case 'ArrowRight': {
          event.preventDefault()
          if (activeNode.childIds.length > 0 && !model.isExpanded(activeNodeId)) {
            toggleNode(activeNodeId)
            break
          }
          const nextRow = model.visibleRows[activeIndex + 1]
          if (nextRow?.depth === activeRow.depth + 1) moveActiveToIndex(activeIndex + 1)
          break
        }
        case 'ArrowLeft': {
          event.preventDefault()
          if (activeNode.childIds.length > 0 && model.isExpanded(activeNodeId)) {
            toggleNode(activeNodeId)
            break
          }
          for (let index = activeIndex - 1; index >= 0; index--) {
            if (model.visibleRows[index].depth === activeRow.depth - 1) {
              moveActiveToIndex(index)
              break
            }
          }
          break
        }
        case 'Enter':
        case ' ':
          event.preventDefault()
          handleClick(activeNodeId)
          break
      }
    },
    [activeNodeId, handleClick, model, moveActiveToIndex, toggleNode]
  )

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
          <span className="min-w-0 truncate">{t('trace.name')}</span>
        </div>
        <div className="flex h-8 min-w-0 items-center justify-center bg-background-subtle px-2 text-center font-medium text-muted-foreground text-xs max-[520px]:px-1">
          <span className="min-w-0 truncate">{t('trace.spendTime')}</span>
        </div>
        <div className="flex h-8 min-w-0 items-center bg-background-subtle px-2 max-[520px]:px-1" />
      </div>
      <div
        ref={scrollerRef}
        data-testid="trace-list-scroll"
        role="tree"
        aria-label={t('trace.label')}
        aria-activedescendant={activeNodeId ? getTraceTreeItemId(activeNodeId) : undefined}
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        onKeyDown={handleTreeKeyDown}
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
                  isActive={node.id === activeNodeId}
                  expandLabel={expandLabel}
                  collapseLabel={collapseLabel}
                  handleClick={selectNode}
                  handleToggle={toggleNode}
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
  isActive,
  expandLabel,
  collapseLabel,
  handleClick,
  handleToggle
}: {
  node: TraceNode
  rootNode: TraceNode
  depth: number
  isExpanded: boolean
  isActive: boolean
  expandLabel: string
  collapseLabel: string
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
      id={getTraceTreeItemId(node.id)}
      data-trace-row={node.id}
      role="treeitem"
      aria-label={node.name}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={-1}
      className={`${TRACE_ROW_GRID} h-8 w-full overflow-hidden border-border-subtle border-b-[0.5px] px-2 text-xs hover:cursor-pointer hover:bg-accent max-[520px]:px-1 [&>div]:min-w-0 ${isActive ? 'bg-accent' : ''}`}
      onClick={(event) => {
        event.preventDefault()
        handleClick(node.id)
      }}>
      <div className="min-w-0 overflow-hidden text-left" style={{ paddingLeft: `${depth * 4 + 2}px` }}>
        <div className="flex min-w-0 flex-row items-center gap-1.5 overflow-hidden">
          <Button
            aria-label={isExpanded ? collapseLabel : expandLabel}
            aria-expanded={hasChildren ? isExpanded : undefined}
            tabIndex={-1}
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
            title={node.name}
            className={`${node.status === 'ERROR' ? 'text-destructive' : 'text-foreground'} min-w-0 flex-1 cursor-pointer select-none truncate whitespace-nowrap`}>
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
