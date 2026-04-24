/**
 * Per-execution streaming collector state.
 *
 * Every consumer that mounts `ExecutionStreamCollector`s keeps the same
 * shape: a `Record<executionId, CherryUIMessage[]>` that mounted
 * collectors push into via `onMessagesChange`, pruned when collectors
 * unmount via `onDispose`, and wiped when `activeExecutionIds` drops to
 * empty.
 */
import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useState } from 'react'

export interface ExecutionMessagesApi {
  executionMessagesById: Record<string, CherryUIMessage[]>
  handleExecutionMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  handleExecutionDispose: (executionId: string) => void
  /** Force-clear the overlay without waiting for `activeExecutionIds` to drain. */
  resetExecutionMessages: () => void
}

export function useExecutionMessages(activeExecutionIds: readonly string[]): ExecutionMessagesApi {
  const [executionMessagesById, setExecutionMessagesById] = useState<Record<string, CherryUIMessage[]>>({})

  useEffect(() => {
    if (activeExecutionIds.length === 0) {
      setExecutionMessagesById({})
      return
    }
    const activeSet = new Set<string>(activeExecutionIds)
    setExecutionMessagesById((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([executionId]) => activeSet.has(executionId)))
    )
  }, [activeExecutionIds])

  const handleExecutionMessagesChange = useCallback((executionId: string, messages: CherryUIMessage[]) => {
    setExecutionMessagesById((prev) => ({ ...prev, [executionId]: messages }))
  }, [])

  const handleExecutionDispose = useCallback((executionId: string) => {
    setExecutionMessagesById((prev) => {
      if (!(executionId in prev)) return prev
      const next = { ...prev }
      delete next[executionId]
      return next
    })
  }, [])

  const resetExecutionMessages = useCallback(() => setExecutionMessagesById({}), [])

  return { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose, resetExecutionMessages }
}

/** Flatten assistant messages from all active collectors in mount order. */
export function collectLiveAssistants(byId: Record<string, CherryUIMessage[]>): CherryUIMessage[] {
  const out: CherryUIMessage[] = []
  for (const execMessages of Object.values(byId)) {
    for (const m of execMessages) {
      if (m.role === 'assistant') out.push(m)
    }
  }
  return out
}
