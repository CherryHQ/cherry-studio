import './Trace.css'

import type { SpanEntity } from '@mcp-trace/trace-core'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SpanDetail from './SpanDetail'
import type { TraceModal } from './TraceModel'
import TraceTree from './TraceTree'

export interface TracePageProp {
  topicId: string
  traceId: string
  modelName?: string
  reload?: unknown
}

export const TracePage: React.FC<TracePageProp> = ({ topicId, traceId, modelName, reload = false }) => {
  const [spans, setSpans] = useState<TraceModal[]>([])
  const [selectNode, setSelectNode] = useState<TraceModal | null>(null)
  const [showList, setShowList] = useState(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const { t } = useTranslation()

  const mergeTraceModals = useCallback((oldNodes: TraceModal[], newNodes: TraceModal[]): TraceModal[] => {
    const oldMap = new Map(oldNodes.map((n) => [n.id, n]))
    return newNodes.map((newNode) => {
      const oldNode = oldMap.get(newNode.id)
      if (oldNode) {
        oldNode.children = mergeTraceModals(oldNode.children, newNode.children)
        Object.assign(oldNode, newNode)
        return oldNode
      } else {
        return newNode
      }
    })
  }, [])

  const updatePercentAndStart = useCallback((nodes: TraceModal[], rootStart?: number, rootEnd?: number) => {
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

  const getRootSpan = (spans: SpanEntity[]): TraceModal[] => {
    const map: Map<string, TraceModal> = new Map()

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
  }

  const findNodeById = useCallback((nodes: TraceModal[], id: string): TraceModal | null => {
    for (const n of nodes) {
      if (n.id === id) return n
      if (n.children) {
        const found = findNodeById(n.children, id)
        if (found) return found
      }
    }
    return null
  }, [])

  const getTraceData = useCallback(async (): Promise<boolean> => {
    const datas = topicId && traceId ? await window.api.trace.getData(topicId, traceId, modelName) : []
    const matchedSpans = getRootSpan(datas)
    updatePercentAndStart(matchedSpans)
    setSpans((prev) => mergeTraceModals(prev, matchedSpans))
    if (matchedSpans.length === 0) {
      return false
    }
    const isEnded = !matchedSpans.find((e) => !e.endTime || e.endTime <= 0)
    return isEnded
  }, [topicId, traceId, modelName, updatePercentAndStart, mergeTraceModals])

  const handleNodeClick = (nodeId: string) => {
    const latestNode = findNodeById(spans, nodeId)
    if (latestNode) {
      setSelectNode(latestNode)
      setShowList(false)
    }
  }

  const handleShowList = () => {
    setShowList(true)
    setSelectNode(null)
  }

  useEffect(() => {
    setSpans([])
    setSelectNode(null)
    setShowList(true)
  }, [topicId, traceId, modelName])

  useEffect(() => {
    const handleShowTrace = async () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      let endedCount = 0
      const poll = async () => {
        const ended = await getTraceData()
        endedCount = ended ? endedCount + 1 : 0
        if (endedCount >= 3 && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
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
  }, [getTraceData, traceId, topicId, reload])

  useEffect(() => {
    if (selectNode) {
      const latest = findNodeById(spans, selectNode.id)
      if (!latest) {
        setShowList(true)
        setSelectNode(null)
      } else if (latest !== selectNode) {
        setSelectNode(latest)
      }
    }
  }, [spans, selectNode, findNodeById])

  return (
    <div className="trace-window">
      <div className="tab-container_trace">
        <div className="scroll-container">
          {showList ? (
            <div
              data-testid="trace-list-scroll"
              className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overflow-x-hidden p-3">
              {spans.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground text-xs">
                  {t('trace.noTraceList')}
                </div>
              ) : (
                <div
                  data-testid="trace-table"
                  className="min-w-0 overflow-hidden rounded-md border border-border-subtle bg-card">
                  <div className="floating trace-table-grid w-full">
                    <div className="table-header text-left">
                      <span tabIndex={0}>{t('trace.name')}</span>
                    </div>
                    <div className="table-header justify-center text-center">
                      <span>{t('trace.tokenUsage')}</span>
                    </div>
                    <div className="table-header justify-center text-center">
                      <span>{t('trace.spendTime')}</span>
                    </div>
                    <div className="table-header" />
                  </div>
                  {spans.map((node: TraceModal) => (
                    <TraceTree key={node.id} treeData={node.children} node={node} handleClick={handleNodeClick} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            selectNode && <SpanDetail node={selectNode} clickShowModal={handleShowList} />
          )}
        </div>
      </div>
    </div>
  )
}
