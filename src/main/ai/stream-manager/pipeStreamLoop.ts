/**
 * `pipeStreamLoop` — the shared chunk-pipe primitive.
 *
 * Drives a `ReadableStream<UIMessageChunk>` produced by `Agent.stream(...)` and
 * delivers each chunk via the supplied `onChunk` callback. Concurrently runs
 * AI SDK's `readUIMessageStream` to accumulate a `CherryUIMessage` snapshot;
 * the latest snapshot is reported through `onAccumulatedSnapshot` per yield
 * and returned in the result.
 *
 * No knowledge of topics, executions, persistence, or multi-model state —
 * those concerns live entirely in the caller. Both the chat read-loop
 * (`AiStreamManager.runExecutionLoop`) and the ad-hoc prompt-stream handler
 * (`AiService.runPromptStream`) call this primitive with their own
 * `onChunk` strategies (chat fans out to listeners + buffer + status; prompt-
 * stream just forwards to a single WebContents).
 *
 * Behaviour contract:
 *  - Caller-owned `signal` cancels the broadcast reader. The accumulator
 *    reader is not cancelled directly — `Agent.stream` honours the same
 *    signal upstream and propagates `done` through `tee()`, so the
 *    accumulator drains naturally. Cancelling its reader directly would
 *    race AI SDK's internal `controller.close()` and produce an
 *    `ERR_INVALID_STATE` unhandledRejection. Idle-timeout, if desired,
 *    is the caller's job (wrap the input stream with `withIdleTimeout`).
 *  - In-stream error chunks (`chunk.type === 'error'`) are captured into
 *    `streamErrorText` for the caller to act on; they are NOT thrown.
 *  - The function never throws: a thrown error from the broadcast read or
 *    pre-stream setup is caught and returned as `threw`. Callers branch on
 *    `threw` / `streamErrorText` / `signal.aborted` to map to terminal events.
 *  - Accumulator errors are swallowed (the accumulator is best-effort
 *    bookkeeping; the broadcast path is the source of truth for terminal
 *    status).
 *  - `broadcastCompletedAt` is captured the moment the broadcast loop ends,
 *    *before* awaiting the accumulator drain — so callers tracking
 *    provider-side completion time (TTFT-style stats) aren't inflated by
 *    internal bookkeeping.
 */

import { type CherryUIMessage } from '@shared/data/types/message'
import { readUIMessageStream, type UIMessageChunk } from 'ai'

export interface PipeStreamLoopOptions {
  /** Invoked synchronously for every chunk that comes off the broadcast reader. */
  onChunk: (chunk: UIMessageChunk) => void
  /**
   * Seed for AI SDK's `readUIMessageStream`. Used by `continue-conversation`
   * to resume accumulating into the existing assistant message — without the
   * seed, `getToolInvocation` lookups throw and the accumulator silently
   * halts, leaving `finalMessage.parts === []`.
   */
  accumulatorSeed?: CherryUIMessage
  /**
   * Invoked per accumulator snapshot (every yield from `readUIMessageStream`).
   * Callers that want live mid-stream finalMessage visibility (chat path:
   * `inspect()` reads `exec.finalMessage`) install a setter here.
   */
  onAccumulatedSnapshot?: (msg: CherryUIMessage) => void
}

export interface PipeStreamLoopResult {
  /** Last snapshot yielded by `readUIMessageStream` (undefined if none yielded). */
  finalMessage?: CherryUIMessage
  /** First in-stream error chunk's `errorText`. Present even if the loop completed without throwing. */
  streamErrorText?: string
  /** Thrown error from the broadcast loop or pre-stream setup. `undefined` on success path. */
  threw?: unknown
  /** Timestamp captured the moment the broadcast loop ended — before accumulator drain. */
  broadcastCompletedAt: number
}

/**
 * Drive the broadcast + accumulator pair to completion. Never throws.
 */
export async function pipeStreamLoop(
  stream: ReadableStream<UIMessageChunk>,
  signal: AbortSignal,
  options: PipeStreamLoopOptions
): Promise<PipeStreamLoopResult> {
  const [forBroadcast, forAccum] = stream.tee()

  // Accumulator runs concurrently. Errors are swallowed (best-effort), the
  // last successful snapshot stays in `finalMessage`.
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

  // Drain the accumulator regardless of broadcast outcome — it may have
  // processed a few more chunks before the broadcast errored / closed.
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
