import type { SpanEntity } from '@mcp-trace/trace-core'
import type { TraceDataCursor } from '@shared/data/types/trace'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SpanDetail from './SpanDetail'
import { TRACE_ROW_GRID, type TraceNode } from './traceNode'
import TraceTree from './TraceTree'

const TRACE_POLL_INTERVAL_MS = 1_000
const TRACE_IDLE_POLL_INTERVAL_MS = 5_000

export interface TracePageProps {
  topicId: string
  traceId: string
}

export const TracePage: React.FC<TracePageProps> = ({ topicId, traceId }) => {
  const [spans, setSpans] = useState<TraceNode[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const failureCountRef = useRef(0)
  const nodesByIdRef = useRef(new Map<string, TraceNode>())
  const traceIdleRef = useRef(true)
  const { t } = useTranslation()

  const updatePercentAndStart = useCallback((nodes: TraceNode[], rootStart?: number, rootEnd?: number) => {
    nodes.forEach((node) => {
      const _rootStart = rootStart || node.startTime
      const _rootEnd = rootEnd || node.endTime || Date.now()
      const endTime = node.endTime || _rootEnd
      const usedTime = endTime - node.startTime
      const duration = _rootEnd - _rootStart
      node.start = ((node.startTime - _rootStart) * 100) / duration
      node.percent = duration === 0 ? 0 : (usedTime * 100) / duration
      if (node.children) {
        updatePercentAndStart(node.children, _rootStart, _rootEnd)
      }
    })
  }, [])

  const applySpanChanges = useCallback((changedSpans: SpanEntity[], reset: boolean): TraceNode[] | null => {
    if (!reset && changedSpans.length === 0) return null

    const nodesById = nodesByIdRef.current
    if (reset) nodesById.clear()

    for (const span of changedSpans) {
      const existing = nodesById.get(span.id)
      if (existing) {
        nodesById.set(span.id, { ...existing, ...span })
      } else {
        nodesById.set(span.id, { ...span, children: [], percent: 100, start: 0 })
      }
    }

    const roots: TraceNode[] = []
    let hasInFlightSpan = false
    for (const node of nodesById.values()) {
      node.children = []
      if (!node.endTime || node.endTime <= 0) hasInFlightSpan = true
    }
    for (const node of nodesById.values()) {
      const parent = node.parentId ? nodesById.get(node.parentId) : undefined
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
    traceIdleRef.current = nodesById.size === 0 || !hasInFlightSpan
    return roots
  }, [])

  const handleNodeClick = (nodeId: string) => {
    if (nodesByIdRef.current.has(nodeId)) {
      setSelectedNodeId(nodeId)
    }
  }

  const handleShowList = () => {
    setSelectedNodeId(null)
  }

  // Resolve selection from the same id map used for incremental updates. A node
  // that vanished from a reset snapshot falls back to the list view.
  const selectedNode = selectedNodeId ? (nodesByIdRef.current.get(selectedNodeId) ?? null) : null
  const showList = !selectedNode

  // Ref-guarded against <Activity> re-show: hide/show re-runs this effect with
  // an unchanged key, and clearing here would wipe the loaded trace before the
  // refreshed poll result arrives.
  const resetKeyRef = useRef(`${topicId}:${traceId}`)
  useEffect(() => {
    const key = `${topicId}:${traceId}`
    if (resetKeyRef.current === key) return
    resetKeyRef.current = key
    nodesByIdRef.current.clear()
    traceIdleRef.current = true
    setSpans([])
    setSelectedNodeId(null)
  }, [topicId, traceId])

  useEffect(() => {
    let cancelled = false
    let finished = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let cursor: TraceDataCursor | undefined

    failureCountRef.current = 0
    setPollError(null)

    const stop = () => {
      finished = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const poll = async (): Promise<number> => {
      try {
        const result = await window.api.trace.getData(topicId, traceId, cursor)
        if (cancelled) return TRACE_IDLE_POLL_INTERVAL_MS
        cursor = result.cursor
        failureCountRef.current = 0
        const changedRoots = applySpanChanges(result.spans, result.reset)

        // Publish on every change to the node map, INCLUDING a reset that emptied it. `spans` is what
        // renders while `nodesByIdRef` resolves clicks and the selection, so letting the two diverge
        // leaves rows on screen that answer to neither.
        if (changedRoots) {
          updatePercentAndStart(changedRoots)
          setSpans(changedRoots)
        }

        return traceIdleRef.current ? TRACE_IDLE_POLL_INTERVAL_MS : TRACE_POLL_INTERVAL_MS
      } catch (error) {
        if (cancelled) return TRACE_IDLE_POLL_INTERVAL_MS
        failureCountRef.current++
        if (failureCountRef.current >= 3) {
          stop()
          setPollError(error instanceof Error ? error.message : String(error))
        }
        return TRACE_POLL_INTERVAL_MS
      }
    }

    const run = async () => {
      const nextInterval = await poll()
      // Schedule only after the request settles so a slow trace read can never create
      // overlapping IPC requests and concurrent full-file parsing work.
      if (cancelled || finished) return
      timeoutId = setTimeout(() => void run(), nextInterval)
    }

    if (!topicId || !traceId) {
      nodesByIdRef.current.clear()
      traceIdleRef.current = true
      setSpans([])
      return
    }

    void run()

    return () => {
      cancelled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }
  }, [topicId, traceId, applySpanChanges, updatePercentAndStart])

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {showList ? (
            <div
              data-testid="trace-list-scroll"
              className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
              {pollError ? (
                <div className="flex h-full min-h-40 items-center justify-center text-destructive text-xs">
                  {t('trace.pollError')}: {pollError}
                </div>
              ) : spans.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground text-xs">
                  {t('trace.noTraceList')}
                </div>
              ) : (
                <div
                  data-testid="trace-table"
                  className="min-w-0 overflow-hidden rounded-md border border-border-subtle bg-card">
                  <div className={`${TRACE_ROW_GRID} sticky top-0 z-[2] w-full border-border border-b-[0.5px] bg-card`}>
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
                  {spans.map((node: TraceNode) => (
                    <TraceTree key={node.id} treeData={node.children} node={node} handleClick={handleNodeClick} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            selectedNode && <SpanDetail node={selectedNode} onShowList={handleShowList} />
          )}
        </div>
      </div>
    </div>
  )
}
