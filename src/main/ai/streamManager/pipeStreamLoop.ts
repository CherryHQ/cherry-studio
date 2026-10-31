/**
 * Broadcasts chunks and accumulates SDK message snapshots on independent branches.
 * Upstream failures close the input boundary normally so queued content can drain.
 */

import { readUIMessageStream, type UIMessageChunk } from 'ai'

import { type CherryUIMessage } from '@shared/data/types/message'
import type { ErrorStage } from '@shared/utils/errorCategory'

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
  /** Upstream, setup or broadcast failure. Wrapped to distinguish a thrown `undefined` from no error. */
  threw?: { error: unknown }
  /** SDK accumulation or snapshot callback failure; never stops the broadcast branch.
   *  `stage` names the failing phase so a malformed-chunk failure is not mistaken for a persist-write failure. */
  accumulationError?: { error: unknown; stage: ErrorStage }
  /** Captured before accumulator drain. */
  broadcastCompletedAt: number
}

export async function pipeStreamLoop(
  stream: ReadableStream<UIMessageChunk>,
  signal: AbortSignal,
  options: PipeStreamLoopOptions
): Promise<PipeStreamLoopResult> {
  let finalMessage: CherryUIMessage | undefined
  let streamErrorText: string | undefined
  let threw: { error: unknown } | undefined
  let accumulationError: { error: unknown; stage: ErrorStage } | undefined
  const onAccumulationError = (error: unknown, stage: ErrorStage) => {
    accumulationError ??= { error, stage }
  }
  const boundary = new TransformStream<UIMessageChunk, UIMessageChunk>()
  const [forBroadcast, forAccum] = boundary.readable.tee()
  const accumulator = runAccumulator(
    forAccum,
    options.accumulatorSeed,
    (message) => {
      finalMessage = message
      options.onAccumulatedSnapshot?.(message)
    },
    onAccumulationError
  )

  const stop = new AbortController()
  const forwardingSignal = AbortSignal.any([signal, stop.signal])
  // Prevent an upstream error/abort from discarding chunks already queued for either consumer.
  const forwarding = stream
    .pipeTo(boundary.writable, {
      preventAbort: true,
      preventClose: true,
      signal: forwardingSignal
    })
    .catch((error: unknown) => {
      if (!forwardingSignal.aborted) threw ??= { error }
    })
    .finally(async () => {
      // Both consumers may already have cancelled; that close failure must not replace the original error.
      await boundary.writable.close().catch(() => {})
    })

  const broadcastReader = forBroadcast.getReader()
  const onAbort = () => {
    void broadcastReader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  let broadcastCompletedAt: number
  try {
    while (true) {
      const { done, value } = await broadcastReader.read()
      if (done) break
      if (value.type === 'error') streamErrorText ??= value.errorText
      options.onChunk(value)
    }
    broadcastCompletedAt = performance.now()
  } catch (error) {
    threw ??= { error }
    broadcastCompletedAt = performance.now()
    stop.abort(error)
    void broadcastReader.cancel(error).catch(() => {})
  } finally {
    signal.removeEventListener('abort', onAbort)
    broadcastReader.releaseLock()
  }

  await forwarding
  await accumulator
  return { finalMessage, streamErrorText, threw, accumulationError, broadcastCompletedAt }
}

async function runAccumulator(
  source: ReadableStream<UIMessageChunk>,
  seed: CherryUIMessage | undefined,
  onSnapshot: (message: CherryUIMessage) => void,
  onError: (error: unknown, stage: ErrorStage) => void
): Promise<void> {
  // Provider error chunks are handled by broadcast; the SDK also calls onError for them.
  const input = source.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type !== 'error') controller.enqueue(chunk)
      }
    })
  )
  let reader: ReadableStreamDefaultReader<CherryUIMessage> | undefined
  try {
    // Malformed chunk sequences (e.g. a reasoning-end with an unopened ID) fail here: provider-output parsing.
    reader = readUIMessageStream<CherryUIMessage>({
      stream: input,
      message: seed,
      onError: (error) => onError(error, 'parse')
    }).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      try {
        onSnapshot(value)
      } catch (error) {
        onError(error, 'runtime')
      }
    }
  } catch (error) {
    onError(error, 'parse')
    // Setup can fail before the SDK acquires input; do not await tee cancellation while broadcast is live.
    void input.cancel(error).catch(() => {})
  } finally {
    reader?.releaseLock()
  }
}
