import type { UIMessageChunk } from 'ai'

import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'

import type { PipeStreamLoopResult } from './pipeStreamLoop'
import type { MessageStreamEvent } from './types'

/** Publishes complete product messages and forwards execution controls without accumulating another body. */
export async function pipeMessageStream(
  stream: ReadableStream<MessageStreamEvent>,
  signal: AbortSignal,
  message: CherryUIMessage,
  onMessage: (message: CherryUIMessage) => void,
  onControl: (chunk: UIMessageChunk) => void
): Promise<PipeStreamLoopResult> {
  const reader = stream.getReader()
  let streamErrorText: string | undefined
  let threw: { error: unknown } | undefined
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'error') {
        threw = { error: value.error }
        break
      }
      if (value.type === 'message') {
        message = { ...message, parts: value.parts }
      } else {
        const chunk = value.chunk as CherryUIMessageChunk
        onControl(chunk)
        if (chunk.type === 'error') streamErrorText ??= chunk.errorText
        if (chunk.type === 'message-metadata' || chunk.type === 'finish' || chunk.type === 'start') {
          const metadata = chunk.messageMetadata
          if (metadata)
            message = {
              ...message,
              metadata: { ...message.metadata, ...metadata, stats: { ...message.metadata?.stats, ...metadata.stats } }
            }
        }
      }
      onMessage(message)
    }
  } catch (error) {
    threw = { error }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (threw) await reader.cancel(threw.error).catch(() => {})
    reader.releaseLock()
  }
  return { finalMessage: message, streamErrorText, threw, broadcastCompletedAt: performance.now() }
}
