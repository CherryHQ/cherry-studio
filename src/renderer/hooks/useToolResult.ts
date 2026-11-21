import { useEffect, useMemo, useState } from 'react'

import { toolResultService, type ToolResultSnapshot } from '@renderer/services/aiTransport'
import type { AiToolResultReadOptions, DeferredToolResultRef } from '@shared/ai/transport'

const IDLE: ToolResultSnapshot = Object.freeze({ status: 'idle' })

/** Details remain scoped to their mounted consumer; full reads require an explicit purpose. */
export function useToolResult(
  ref: DeferredToolResultRef | undefined,
  purpose: 'preview' | 'full' | AiToolResultReadOptions = 'preview'
) {
  const topicId = ref?.topicId
  const messageId = ref?.messageId
  const toolCallId = ref?.toolCallId
  const readPurpose = typeof purpose === 'string' ? purpose : purpose.purpose
  const cursor = typeof purpose === 'object' && purpose.purpose === 'text-range' ? purpose.cursor : undefined
  const selection = useMemo(() => {
    if (!topicId || !messageId || !toolCallId) return undefined
    const options: AiToolResultReadOptions =
      readPurpose === 'text-range' ? { purpose: readPurpose, cursor } : { purpose: readPurpose }
    return { ref: { topicId, messageId, toolCallId }, options }
  }, [topicId, messageId, toolCallId, readPurpose, cursor])
  const [result, setResult] = useState<{ selection: typeof selection; state: ToolResultSnapshot; generation: number }>({
    selection,
    state: selection ? toolResultService.getSnapshot(selection.ref, selection.options) : IDLE,
    generation: 0
  })

  useEffect(() => {
    setResult({
      selection,
      state: selection ? toolResultService.getSnapshot(selection.ref, selection.options) : IDLE,
      generation: 0
    })
    if (!selection) return
    return toolResultService.subscribe(selection.ref, selection.options, (state) =>
      setResult((current) => ({
        selection,
        state,
        generation: (current.selection === selection ? current.generation : 0) + (state.status === 'loading' ? 1 : 0)
      }))
    )
  }, [selection])

  const state =
    result.selection === selection
      ? result.state
      : selection
        ? toolResultService.getSnapshot(selection.ref, selection.options)
        : IDLE
  return {
    output: state.status === 'ready' && state.purpose !== 'text-range' ? state.output : undefined,
    error: state.status === 'error' ? state.error : undefined,
    isLoading: state.status === 'loading' || (state.status === 'idle' && !!selection),
    state,
    generation: result.selection === selection ? result.generation : 0
  }
}
