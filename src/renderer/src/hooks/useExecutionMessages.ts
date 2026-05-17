import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useState } from 'react'

export interface ExecutionMessagesApi {
  executionMessagesById: Record<string, CherryUIMessage[]>
  handleExecutionMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  handleExecutionDispose: (executionId: string) => void
  resetExecutionMessages: () => void
}

export function useExecutionMessages(): ExecutionMessagesApi {
  const [executionMessagesById, setExecutionMessagesById] = useState<Record<string, CherryUIMessage[]>>({})

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
