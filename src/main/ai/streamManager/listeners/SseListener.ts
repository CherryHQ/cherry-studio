import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

/**
 * StreamListener that writes UIMessageChunk to an HTTP SSE response.
 *
 * Used by API Gateway endpoints (e.g. /v1/chat/completions with stream=true)
 * to subscribe to AiStreamManager as an equal subscriber alongside
 * WebContentsListener and ChannelAdapterListener.
 *
 * Two mapping modes (pick one via options):
 * - `mapChunk`: map a chunk to a single JSON-serializable payload; written as
 *   one `data: <json>\n\n` frame. Good for near-1:1 formats (OpenAI).
 * - `formatChunk`: map a chunk to fully-formatted SSE frame string(s), written
 *   verbatim. Supports 1→N output and named `event:` frames — required for
 *   block-structured formats (Anthropic `message_start`/`content_block_*`/…).
 *   A stateful closure here can reuse a format adapter + SSE formatter.
 *
 * `formatDone` overrides the terminal marker (OpenAI uses `data: [DONE]`,
 * Anthropic has none — the adapter's `message_stop` already ended it).
 */
export class SseListener implements StreamListener {
  readonly id: string

  private readonly mapChunk?: (chunk: UIMessageChunk) => unknown | null
  private readonly formatChunk?: (chunk: UIMessageChunk) => string | string[] | null
  private readonly formatDone?: () => string
  private readonly formatPaused?: () => string
  private readonly formatError?: (error: StreamErrorResult['error']) => string

  constructor(
    private readonly write: (data: string) => void,
    private readonly end: () => void,
    private readonly alive: () => boolean,
    options?: {
      id?: string
      /** Map UIMessageChunk to a JSON-serializable SSE payload. Default: pass through. */
      mapChunk?: (chunk: UIMessageChunk) => unknown | null
      /** Map UIMessageChunk to pre-formatted SSE frame string(s), written verbatim. Takes precedence over mapChunk. */
      formatChunk?: (chunk: UIMessageChunk) => string | string[] | null
      /** Terminal marker written on a clean done. Default: `data: [DONE]\n\n`. */
      formatDone?: () => string
      /**
       * Terminal frame written on pause (idle-timeout / mid-stream abort). Lets a
       * consumer signal truncation instead of a clean completion. Default: same as
       * `formatDone` (the historical behaviour).
       */
      formatPaused?: () => string
      /** Format a terminal stream error into an SSE frame. Default: a generic `{type:'error'}` JSON frame. */
      formatError?: (error: StreamErrorResult['error']) => string
    }
  ) {
    this.id = options?.id ?? `sse:${crypto.randomUUID()}`
    this.mapChunk = options?.mapChunk
    this.formatChunk = options?.formatChunk
    this.formatDone = options?.formatDone
    this.formatPaused = options?.formatPaused
    this.formatError = options?.formatError
  }

  onChunk(chunk: UIMessageChunk): void {
    if (!this.alive()) return

    if (this.formatChunk) {
      const frames = this.formatChunk(chunk)
      if (frames == null) return
      for (const frame of Array.isArray(frames) ? frames : [frames]) {
        if (frame) this.write(frame)
      }
      return
    }

    const mapped = this.mapChunk ? this.mapChunk(chunk) : chunk
    if (mapped !== null && mapped !== undefined) {
      this.write(`data: ${JSON.stringify(mapped)}\n\n`)
    }
  }

  // oxlint-disable-next-line no-unused-vars
  onDone(_result: StreamDoneResult): void {
    if (!this.alive()) return
    this.write(this.formatDone ? this.formatDone() : 'data: [DONE]\n\n')
    this.end()
  }

  // oxlint-disable-next-line no-unused-vars
  onPaused(_result: StreamPausedResult): void {
    if (!this.alive()) return
    if (this.formatPaused) {
      this.write(this.formatPaused())
    } else {
      this.write(this.formatDone ? this.formatDone() : 'data: [DONE]\n\n')
    }
    this.end()
  }

  onError(result: StreamErrorResult): void {
    if (!this.alive()) return
    this.write(
      this.formatError
        ? this.formatError(result.error)
        : `data: ${JSON.stringify({ type: 'error', error: result.error })}\n\n`
    )
    this.end()
  }

  isAlive(): boolean {
    return this.alive()
  }
}
