import type { AgentControlChunk } from '@main/ai/runtime/types'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { PipeStreamLoopResult } from './pipeStreamLoop'
import type { AgentMessageStreamSource, AgentPartChange, ExecutionPart } from './types'

export function materializeAgentMessage(
  header: Omit<CherryUIMessage, 'parts' | 'partIds'>,
  entries: readonly Pick<ExecutionPart, 'partId' | 'payload'>[]
) {
  return {
    ...header,
    parts: entries.map(({ payload }) => payload),
    partIds: entries.map(({ partId }) => partId)
  } satisfies CherryUIMessage
}

/** Materializes the owner's baseline and terminal reply and relays live parts in between. */
export async function pipeMessageStream(
  source: AgentMessageStreamSource,
  signal: AbortSignal,
  header: Omit<CherryUIMessage, 'parts' | 'partIds'>,
  onMessage: (message: ReturnType<typeof materializeAgentMessage>) => void,
  onControl: (chunk: AgentControlChunk, metadata?: CherryUIMessage['metadata']) => void,
  onPartChange: (change: AgentPartChange) => void
): Promise<PipeStreamLoopResult> {
  const reader = source.stream.getReader()
  const readMessage = () => materializeAgentMessage(header, source.readParts())
  let threw: { error: unknown } | undefined
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  function deliver<T>(consume: (value: T) => void) {
    return (value: T) => {
      if (signal.aborted || threw) return
      try {
        consume(value)
      } catch (error) {
        threw = { error }
        onAbort()
      }
    }
  }
  const parts = source.onPart(deliver(onPartChange))
  const reconciled = source.onMessageReconciled(
    deliver((entries: readonly ExecutionPart[]) => onMessage(materializeAgentMessage(header, entries)))
  )
  try {
    onMessage(readMessage())
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'error') {
        threw = { error: value.error }
        break
      }
      const chunk = value.chunk
      let metadata: CherryUIMessage['metadata']
      if (chunk.type === 'message-metadata') {
        metadata = {
          ...header.metadata,
          ...chunk.messageMetadata,
          stats: { ...header.metadata?.stats, ...chunk.messageMetadata.stats }
        }
        header = { ...header, metadata }
      }
      onControl(chunk, metadata)
    }
  } catch (error) {
    threw = { error }
  } finally {
    parts.dispose()
    reconciled.dispose()
    signal.removeEventListener('abort', onAbort)
    if (threw) await reader.cancel(threw.error).catch(() => {})
    reader.releaseLock()
  }
  return { finalMessage: readMessage(), threw, broadcastCompletedAt: performance.now() }
}
