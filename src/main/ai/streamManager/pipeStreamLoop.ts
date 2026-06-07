/**
 * Shared chunk-pipe primitive. Drives a `ReadableStream<UIMessageChunk>`,
 * delivers each chunk via `onChunk`, and concurrently runs AI SDK's
 * `readUIMessageStream` to accumulate a `CherryUIMessage` snapshot.
 *
 * Contract:
 *  - Never throws. Setup / broadcast errors return as `threw`; in-stream
 *    `chunk.type === 'error'` is captured in `streamErrorText`.
 *  - `signal` cancels the broadcast reader only — the accumulator drains
 *    naturally via `Agent.stream` honouring the same signal upstream.
 *    Cancelling the accumulator reader directly races AI SDK's
 *    `controller.close()` → `ERR_INVALID_STATE`.
 *  - Accumulator errors are swallowed; the broadcast path owns terminal
 *    status.
 *  - `broadcastCompletedAt` is captured before accumulator drain so
 *    callers tracking provider-side completion time aren't inflated.
 */

import { type CherryUIMessage } from '@shared/data/types/message'
import { readUIMessageStream, type UIMessageChunk } from 'ai'

export interface PipeStreamLoopOptions {
  onChunk: (chunk: UIMessageChunk) => void
  /** Seed for `readUIMessageStream`; required by `continue-conversation` so accumulator resumes the existing message. */
  accumulatorSeed?: CherryUIMessage
  /** Per-snapshot callback for live mid-stream finalMessage visibility. */
  onAccumulatedSnapshot?: (msg: CherryUIMessage) => void
}

export interface PipeStreamLoopResult {
  finalMessage?: CherryUIMessage
  /** First in-stream error chunk's `errorText`. */
  streamErrorText?: string
  /** Thrown error from broadcast loop or pre-stream setup. */
  threw?: unknown
  /** Captured before accumulator drain. */
  broadcastCompletedAt: number
}

export async function pipeStreamLoop(
  stream: ReadableStream<UIMessageChunk>,
  signal: AbortSignal,
  options: PipeStreamLoopOptions
): Promise<PipeStreamLoopResult> {
  const [forBroadcast, forAccum] = stream.tee()

  let finalMessage: CherryUIMessage | undefined
  const accumulator = runAccumulator(forAccum, options.accumulatorSeed, (msg: CherryUIMessage) => {
    finalMessage = msg
    options.onAccumulatedSnapshot?.(msg)
  }).catch(() => {
    // Accumulator failures are non-fatal — broadcast loop owns terminal status.
  })

  const broadcastReader = forBroadcast.getReader()
  const onAbort = () => {
    void broadcastReader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  let streamErrorText: string | undefined
  let threw: unknown
  let broadcastCompletedAt: number

  try {
    while (true) {
      const { done, value } = await broadcastReader.read()
      if (done) break
      if (value.type === 'error') streamErrorText ??= value.errorText
      options.onChunk(value)
    }
    broadcastCompletedAt = performance.now()
  } catch (err) {
    threw = err
    broadcastCompletedAt = performance.now()
  } finally {
    signal.removeEventListener('abort', onAbort)
    broadcastReader.releaseLock()
  }

  await accumulator

  return { finalMessage, streamErrorText, threw, broadcastCompletedAt }
}

async function runAccumulator(
  chunkStream: ReadableStream<UIMessageChunk>,
  seed: CherryUIMessage | undefined,
  onSnapshot: (msg: CherryUIMessage) => void
): Promise<void> {
  const uiStream = readUIMessageStream<CherryUIMessage>({ stream: chunkStream, message: seed })
  const reader = uiStream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onSnapshot(value)
    }
  } finally {
    reader.releaseLock()
  }
}
