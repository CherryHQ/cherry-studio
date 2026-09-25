import { useCallback, useEffect, useRef, useState } from 'react'

import { integrationOperations, useIpcOn } from '@renderer/ipc'
import type { IntegrationOperation, IntegrationOperationEvent } from '@shared/types/prometheusIntegration'

const OUTPUT_TAIL_CHARACTERS = 32 * 1024
const REPLAY_PAGE_SIZE = 200

function applyEvent(operation: IntegrationOperation, event: IntegrationOperationEvent): IntegrationOperation {
  const terminal =
    event.status === 'succeeded' ||
    event.status === 'failed' ||
    event.status === 'cancelled' ||
    event.status === 'interrupted'
  const output = event.output ? `${operation.output}${event.output}`.slice(-OUTPUT_TAIL_CHARACTERS) : operation.output

  return {
    ...operation,
    ...(event.status ? { status: event.status } : {}),
    ...(event.stage ? { stage: event.stage } : {}),
    ...(event.progress ? { progress: event.progress } : {}),
    ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(event.result ? { result: event.result } : {}),
    ...(event.recoveryAction ? { recoveryAction: event.recoveryAction } : {}),
    cursor: event.sequence,
    output,
    updatedAt: event.at,
    ...(terminal ? { completedAt: event.at } : {})
  }
}

export function useIntegrationOperation(id?: string, initialOperation?: IntegrationOperation) {
  const [operation, setOperation] = useState<IntegrationOperation | null>(initialOperation ?? null)
  const [error, setError] = useState<string | null>(null)
  const [replaying, setReplaying] = useState(false)
  const cursorRef = useRef(initialOperation?.cursor ?? 0)
  const replayingRef = useRef(false)

  const replay = useCallback(async () => {
    if (!id || replayingRef.current) return
    replayingRef.current = true
    setReplaying(true)
    try {
      let cursor = cursorRef.current
      let latestCursor = cursor
      do {
        const page = await integrationOperations.events(id, cursor, REPLAY_PAGE_SIZE)
        setOperation(page.operation)
        cursor = page.cursor
        latestCursor = page.operation.cursor
        cursorRef.current = cursor
      } while (cursor < latestCursor)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      replayingRef.current = false
      setReplaying(false)
    }
  }, [id])

  useEffect(() => {
    cursorRef.current = initialOperation?.cursor ?? 0
    setOperation(initialOperation ?? null)
    setError(null)
    void replay()
  }, [id, replay])

  useEffect(() => {
    if (!initialOperation || initialOperation.id !== id || initialOperation.cursor <= cursorRef.current) return
    cursorRef.current = initialOperation.cursor
    setOperation(initialOperation)
  }, [id, initialOperation])

  useIpcOn('prometheus.integration.operation_progress', (event) => {
    if (event.operationId !== id || event.sequence <= cursorRef.current) return
    if (event.sequence !== cursorRef.current + 1) {
      void replay()
      return
    }
    cursorRef.current = event.sequence
    setOperation((current) => (current ? applyEvent(current, event) : current))
  })

  const cancel = useCallback(async () => {
    if (!id) return
    try {
      await integrationOperations.cancel(id)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [id])

  const readLog = useCallback(
    (offset?: number, limit?: number) => {
      if (!id) return Promise.reject(new Error('Operation ID is required'))
      return integrationOperations.readLog(id, offset, limit)
    },
    [id]
  )

  const exportLog = useCallback(() => {
    if (!id) return Promise.reject(new Error('Operation ID is required'))
    return integrationOperations.exportLog(id)
  }, [id])

  return { operation, error, replaying, replay, cancel, readLog, exportLog }
}
