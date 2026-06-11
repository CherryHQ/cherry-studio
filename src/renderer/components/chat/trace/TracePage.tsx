import type { SpanEntity } from '@mcp-trace/trace-core'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SpanDetail from './SpanDetail'
import { TRACE_ROW_GRID, type TraceNode } from './traceNode'
import TraceTree from './TraceTree'

export interface TracePageProps {
  topicId: string
  traceId: string
  reload?: unknown
}

export const TracePage: React.FC<TracePageProps> = ({ topicId, traceId, reload = false }) => {
  const [spans, setSpans] = useState<TraceNode[]>([])
  const [selectedNode, setSelectedNode] = useState<TraceNode | null>(null)
  const [showList, setShowList] = useState(true)
  const [pollError, setPollError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const failureCountRef = useRef(0)
  const emptyCountRef = useRef(0)
  const { t } = useTranslation()

  const mergeTraceNodes = useCallback((oldNodes: TraceNode[], newNodes: TraceNode[]): TraceNode[] => {
    const oldMap = new Map(oldNodes.map((n) => [n.id, n]))
    return newNodes.map((newNode) => {
      const oldNode = oldMap.get(newNode.id)
      if (oldNode) {
        const mergedChildren = mergeTraceNodes(oldNode.children, newNode.children)
        return { ...oldNode, ...newNode, children: mergedChildren }
      }
      return newNode
    })
  }, [])

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

  const getRootSpans = useCallback((spans: SpanEntity[]): TraceNode[] => {
    const map: Map<string, TraceNode> = new Map()

    spans.map((span) => {
      map.set(span.id, { ...span, children: [], percent: 100, start: 0 })
    })

    return Array.from(
      map.values().filter((span) => {
        if (span.parentId && map.has(span.parentId)) {
          const parent = map.get(span.parentId)
          if (parent) {
            parent.children.push(span)
          }
          return false
        }
        return true
      })
    )
  }, [])

  const findNodeById = useCallback((nodes: TraceNode[], id: string): TraceNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n
      if (n.children) {
        const found = findNodeById(n.children, id)
        if (found) return found
      }
    }
    return null
  }, [])

  const getTraceData = useCallback(async (): Promise<SpanEntity[]> => {
    return topicId && traceId ? await window.api.trace.getData(topicId, traceId) : []
  }, [topicId, traceId])

  const handleNodeClick = (nodeId: string) => {
    const latestNode = findNodeById(spans, nodeId)
    if (latestNode) {
      setSelectedNode(latestNode)
      setShowList(false)
    }
  }

  const handleShowList = () => {
    setShowList(true)
    setSelectedNode(null)
  }

  useEffect(() => {
    setSpans([])
    setSelectedNode(null)
    setShowList(true)
  }, [topicId, traceId])

  useEffect(() => {
    const handleShowTrace = async () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      failureCountRef.current = 0
      emptyCountRef.current = 0
      setPollError(null)

      let lastSpanCount = 0
      let consecutiveEnded = 0
      const poll = async () => {
        try {
          const spans = topicId && traceId ? await window.api.trace.getData(topicId, traceId) : []
          failureCountRef.current = 0
          const matchedSpans = getRootSpans(spans)

          if (matchedSpans.length === 0) {
            emptyCountRef.current++
            if (emptyCountRef.current >= 30 && lastSpanCount === 0 && intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
              return
            }
          } else {
            emptyCountRef.current = 0
            lastSpanCount = matchedSpans.length
            updatePercentAndStart(matchedSpans)
            setSpans((prev) => mergeTraceNodes(prev, matchedSpans))
          }

          const allEnded = matchedSpans.length > 0 && matchedSpans.every((e) => e.endTime && e.endTime > 0)
          consecutiveEnded = allEnded ? consecutiveEnded + 1 : 0
          if (consecutiveEnded >= 20 && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        } catch (error) {
          failureCountRef.current++
          if (failureCountRef.current >= 3 && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
            setPollError(error instanceof Error ? error.message : String(error))
          }
        }
      }
      await poll()
      intervalRef.current = setInterval(poll, 300)
    }
    void handleShowTrace()
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [getTraceData, topicId, traceId, reload, getRootSpans, updatePercentAndStart, mergeTraceNodes])

  useEffect(() => {
    if (selectedNode) {
      const latest = findNodeById(spans, selectedNode.id)
      if (!latest) {
        setShowList(true)
        setSelectedNode(null)
      } else if (latest !== selectedNode) {
        setSelectedNode(latest)
      }
    }
  }, [spans, selectedNode, findNodeById])

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
                    <div className="flex h-8 min-w-0 items-center bg-background-subtle px-2 text-left font-medium text-foreground-secondary text-xs max-[520px]:px-1">
                      <span tabIndex={0} className="min-w-0 truncate">
                        {t('trace.name')}
                      </span>
                    </div>
                    <div className="flex h-8 min-w-0 items-center justify-center bg-background-subtle px-2 text-center font-medium text-foreground-secondary text-xs max-[520px]:px-1">
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
