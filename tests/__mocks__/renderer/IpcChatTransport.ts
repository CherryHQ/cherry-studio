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
 * Build a `MockExecutionTransport` class bound to a per-test registry so
 * each test owns the lifetime of its captured transports — no module-level
 * state shared across the whole vitest process. Use with `vi.hoisted`:
 *
 *   const { transports } = vi.hoisted(() => ({ transports: new Map<string, MockTransport>() }))
 *
 *   vi.mock('@renderer/transport/IpcChatTransport', async () => {
 *     const { createMockExecutionTransport } = await import('@test-mocks/renderer/IpcChatTransport')
 *     return { ExecutionTransport: createMockExecutionTransport(transports) }
 *   })
 *
 *   beforeEach(() => transports.clear())
 *
 * Drop-in replacement for `ExecutionTransport`. Captures the `start`
 * controller of `reconnectToStream`'s `ReadableStream` so tests can
 * `__pushChunk` / `__close` deterministically. `useChat({ chat, resume:
 * true })` triggers `chat.resumeStream()` → `transport.reconnectToStream()`,
 * which is the path we want to exercise. `sendMessages()` returns a closed
 * stream — not used by `resume: true`.
 */
export function createMockExecutionTransport(transports: Map<string, MockTransport>) {
  // `controller` is intentionally public — TS rejects `private` on the
  // anonymous class returned from a factory (TS4094) and the field is only
  // ever touched via the test-controlled `__pushChunk` / `__close`
  // affordances anyway.
  return class MockExecutionTransport implements MockTransport {
    controller: ReadableStreamDefaultController<unknown> | null = null

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
}
