import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

export interface MockTransport {
  topicId: string
  executionId: UniqueModelId
  __isReady(): boolean
  __pushChunk(chunk: CherryUIMessageChunk): void
  __close(): void
}

/**
 * Per-test registry of constructed mock transports, keyed by `executionId`.
 * Tests retrieve a transport via `transports.get(executionId)` to push chunks.
 * Call `transports.clear()` in `beforeEach`.
 */
export const transports = new Map<string, MockTransport>()

/**
 * Drop-in replacement for `ExecutionTransport` from
 * `@renderer/transport/IpcChatTransport`. Captures the `start` controller of
 * `reconnectToStream`'s `ReadableStream` so tests can `__pushChunk` /
 * `__close` deterministically. `useChat({ chat, resume: true })` triggers
 * `chat.resumeStream()` → `transport.reconnectToStream()`, which is the
 * path we want to exercise. `sendMessages()` returns a closed stream — not
 * used by `resume: true`.
 */
export class MockExecutionTransport implements MockTransport {
  private controller: ReadableStreamDefaultController<unknown> | null = null

  constructor(
    public readonly topicId: string,
    public readonly executionId: UniqueModelId
  ) {
    transports.set(executionId, this)
  }

  reconnectToStream(): Promise<ReadableStream<unknown>> {
    const stream = new ReadableStream({
      start: (c) => {
        this.controller = c
      }
    })
    return Promise.resolve(stream)
  }

  sendMessages(): Promise<ReadableStream<unknown>> {
    return Promise.resolve(new ReadableStream({ start: (c) => c.close() }))
  }

  __isReady(): boolean {
    return this.controller !== null
  }

  __pushChunk(chunk: CherryUIMessageChunk): void {
    this.controller!.enqueue(chunk)
  }

  __close(): void {
    this.controller?.close()
  }
}
