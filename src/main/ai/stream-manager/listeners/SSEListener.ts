import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

/**
 * StreamListener that writes UIMessageChunk to an HTTP SSE response.
 *
 * Used by API Gateway endpoints (e.g. /v1/chat/completions with stream=true)
 * to subscribe to AiStreamManager as an equal subscriber alongside
 * WebContentsListener and ChannelAdapterListener.
 *
 * Supports an optional chunk mapper for format conversion
 * (e.g. UIMessageChunk → OpenAI ChatCompletionChunk).
 */
export class SSEListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly write: (data: string) => void,
    private readonly end: () => void,
    private readonly alive: () => boolean,
    options?: {
      id?: string
      /** Map UIMessageChunk to a JSON-serializable SSE payload. Default: pass through. */
      mapChunk?: (chunk: UIMessageChunk) => unknown | null
    }
  ) {
    this.id = options?.id ?? `sse:${crypto.randomUUID()}`
    this.mapChunk = options?.mapChunk
  }

  private readonly mapChunk?: (chunk: UIMessageChunk) => unknown | null

  onChunk(chunk: UIMessageChunk): void {
    if (!this.alive()) return
    const mapped = this.mapChunk ? this.mapChunk(chunk) : chunk
    if (mapped !== null && mapped !== undefined) {
      this.write(`data: ${JSON.stringify(mapped)}\n\n`)
    }
  }

  // oxlint-disable-next-line no-unused-vars
  onDone(_result: StreamDoneResult): void {
    if (!this.alive()) return
    this.write('data: [DONE]\n\n')
    this.end()
  }

  // oxlint-disable-next-line no-unused-vars
  onPaused(_result: StreamPausedResult): void {
    if (!this.alive()) return
    this.write('data: [DONE]\n\n')
    this.end()
  }

  onError(result: StreamErrorResult): void {
    if (!this.alive()) return
    this.write(`data: ${JSON.stringify({ type: 'error', error: result.error })}\n\n`)
    this.end()
  }

  isAlive(): boolean {
    return this.alive()
  }
}
