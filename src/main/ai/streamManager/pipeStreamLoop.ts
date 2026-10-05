/**
 * Shared chunk-pipe primitive. Drives a `ReadableStream<UIMessageChunk>`,
 * delivers each chunk via `onChunk`, and concurrently runs AI SDK's
 * `readUIMessageStream` to accumulate a `CherryUIMessage` snapshot.
 *
 * Contract:
 *  - Never throws. Setup / broadcast errors return as `threw`; in-stream
 *    `chunk.type === 'error'` is captured in `streamErrorText`.
 *  - `signal` cancels the broadcast reader only.
 *  - `finalMessage` survives a mid-response failure. The accumulator is fed by
 *    the broadcast loop and closed with a synthetic `finish: 'error'`, so the
 *    content already delivered to `onChunk` is what the terminal handler
 *    persists — a stream torn down mid-sentence keeps its partial text instead
 *    of collapsing to an empty message. Accumulator errors are swallowed; the
 *    broadcast path owns terminal status.
 *  - `broadcastCompletedAt` is captured before accumulator drain so
 *    callers tracking provider-side completion time aren't inflated.
 */

import { readUIMessageStream, type UIMessageChunk } from 'ai'

import { type CherryUIMessage } from '@shared/data/types/message'

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
  /** Thrown error from broadcast loop or pre-stream setup. Wrapped so `undefined` remains distinguishable from no error. */
  threw?: { error: unknown }
  /** Captured before accumulator drain. */
  broadcastCompletedAt: number
}

export async function pipeStreamLoop(
  stream: ReadableStream<UIMessageChunk>,
  signal: AbortSignal,
  options: PipeStreamLoopOptions
): Promise<PipeStreamLoopResult> {
  // A single reader feeds both consumers. `tee()` was structurally unable to
  // preserve partial content: when either branch's reader threw, the other lost
  // every chunk still queued in its internal.ReadableStream pair, so content the
  // broadcast had already delivered never reached the accumulator snapshot the
  // terminal handler persists. Pushing into the accumulator directly removes that
  // coupling — the accumulator only ever sees chunks that were already broadcast.
  let finalMessage: CherryUIMessage | undefined
  const accumulator = createSnapshotAccumulator(options.accumulatorSeed, (msg: CherryUIMessage) => {
    finalMessage = msg
    options.onAccumulatedSnapshot?.(msg)
  })

  const broadcastReader = stream.getReader()
  const onAbort = () => {
    void broadcastReader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  let streamErrorText: string | undefined
  let threw: { error: unknown } | undefined
  let broadcastCompletedAt: number

  try {
    while (true) {
      const { done, value } = await broadcastReader.read()
      if (done) break
      if (value.type === 'error') streamErrorText ??= value.errorText
      // Feed before broadcasting so a throwing `onChunk` cannot drop content the
      // terminal handler needs; either way the error below owns terminal status.
      await accumulator.write(value)
      options.onChunk(value)
    }
    broadcastCompletedAt = performance.now()
  } catch (error) {
    threw = { error }
    broadcastCompletedAt = performance.now()
  } finally {
    signal.removeEventListener('abort', onAbort)
    broadcastReader.releaseLock()
  }

  // Close unconditionally: a mid-stream failure leaves the turn's already-broadcast content
  // inside the accumulator, and only a terminal close turns it into a `finalMessage` snapshot.
  await accumulator.close()

  return { finalMessage, streamErrorText, threw, broadcastCompletedAt }
}

/**
 * Push-driven wrapper around `readUIMessageStream` — the accumulator is fed one chunk at a
 * time by the broadcast loop instead of pulling its own tee branch, and closed explicitly.
 */
function createSnapshotAccumulator(
  seed: CherryUIMessage | undefined,
  onSnapshot: (msg: CherryUIMessage) => void
): {
  write: (chunk: UIMessageChunk) => Promise<void>
  close: () => Promise<void>
} {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const source = new ReadableStream<UIMessageChunk>({
    start: (streamController) => {
      controller = streamController
    }
  })
  const uiStream = readUIMessageStream<CherryUIMessage>({ stream: source, message: seed })
  const reader = uiStream.getReader()
  /** Resolves when the accumulator's reader settles; failures are non-fatal (broadcast owns status). */
  const drained = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        onSnapshot(value)
      }
    } catch {
      // A malformed chunk sequence must not lose the snapshots already delivered.
    }
  })()

  return {
    write: async (chunk) => {
      controller.enqueue(chunk)
      // Yield so the accumulator's reader can consume; without this the snapshot lags the
      // broadcast by however many chunks fit in the queue before the next await point.
      await Promise.resolve()
    },
    close: async () => {
      try {
        // A mid-content failure leaves open text/reasoning parts; a synthetic terminal closes
        // them so the snapshot is a readable message rather than a stuttering cursor.
        controller.enqueue({ type: 'finish', finishReason: 'error' })
        controller.close()
      } catch {
        // Already closed — the provider ended the turn with its own terminal chunk.
      }
      await drained
    }
  }
}
