import type { SpanEntity } from '@mcp-trace/trace-core'
import type { TraceDataCursor } from '@shared/data/types/trace'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SpanDetail from './SpanDetail'
import TraceTree from './TraceTree'
import { TraceTreeModel } from './TraceTreeModel'

const TRACE_POLL_INTERVAL_MS = 1_000
const TRACE_IDLE_POLL_INTERVAL_MS = 5_000

export interface TracePageProps {
  topicId: string
  traceId: string
}

export const TracePage = ({ topicId, traceId }: TracePageProps) => {
  const [model] = useState(() => new TraceTreeModel())
  const [treeRevision, setTreeRevision] = useState(model.lastMutation.revision)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const failureCountRef = useRef(0)
  const traceIdleRef = useRef(true)
  const { t } = useTranslation()

  const applySpanChanges = useCallback(
    (changedSpans: SpanEntity[], reset: boolean) => {
      const mutation = reset ? model.reset(changedSpans) : model.applySpanChanges(changedSpans)
      traceIdleRef.current = model.isIdle
      if (mutation) setTreeRevision(mutation.revision)
    },
    [model]
  )

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (model.getNode(nodeId)) setSelectedNodeId(nodeId)
    },
    [model]
  )

  const handleNodeToggle = useCallback(
    (nodeId: string) => {
      const mutation = model.toggle(nodeId)
      if (mutation) setTreeRevision(mutation.revision)
    },
    [model]
  )

  const handleShowList = () => {
    setSelectedNodeId(null)
  }

  const selectedNode = selectedNodeId ? model.getNode(selectedNodeId) : null
  const showList = !selectedNode

  // Ref-guarded against <Activity> re-show: hide/show re-runs this effect with
  // an unchanged key, and clearing here would wipe the loaded trace before the
  // refreshed poll result arrives.
  const resetKeyRef = useRef(`${topicId}:${traceId}`)
  useEffect(() => {
    const key = `${topicId}:${traceId}`
    if (resetKeyRef.current === key) return
    resetKeyRef.current = key
    const mutation = model.reset([])
    traceIdleRef.current = true
    setTreeRevision(mutation.revision)
    setSelectedNodeId(null)
  }, [model, topicId, traceId])

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
        applySpanChanges(result.spans, result.reset)
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
      const mutation = model.reset([])
      traceIdleRef.current = true
      setTreeRevision(mutation.revision)
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
  }, [topicId, traceId, applySpanChanges, model])

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {showList ? (
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden p-3">
              {pollError ? (
                <div className="flex h-full min-h-40 items-center justify-center text-destructive text-xs">
                  {t('trace.pollError')}: {pollError}
                </div>
              ) : model.nodeCount === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground text-xs">
                  {t('trace.noTraceList')}
                </div>
              ) : (
                <TraceTree
                  model={model}
                  revision={treeRevision}
                  handleClick={handleNodeClick}
                  handleToggle={handleNodeToggle}
                />
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
