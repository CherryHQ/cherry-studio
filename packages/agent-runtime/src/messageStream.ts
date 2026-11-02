import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

import type { Completeness, RuntimeMessage } from './contracts'

type ReaderMessage = UIMessage<NonNullable<RuntimeMessage['metadata']> & { revision: number }>

/** One SDK accumulator per native message, before observer fanout. Never seed active parser state from a snapshot. */
export class RuntimeMessageStream {
  private controller!: ReadableStreamDefaultController<UIMessageChunk>
  private readonly reading: Promise<void>
  private pending = Promise.resolve<RuntimeMessage | undefined>(undefined)
  private receipt?: { revision: number; resolve(message: RuntimeMessage): void; reject(error: unknown): void }
  private revision = 0
  private failure?: unknown
  private closed = false

  constructor(id: string) {
    const stream = readUIMessageStream<ReaderMessage>({
      message: { id, role: 'assistant', parts: [] },
      stream: new ReadableStream({
        start: (controller) => {
          this.controller = controller
        }
      }),
      terminateOnError: true
    })
    this.reading = (async () => {
      try {
        for await (const message of stream) {
          if (!this.receipt || message.metadata?.revision !== this.receipt.revision) continue
          const { completeness, inputId } = message.metadata
          this.receipt.resolve({ ...message, metadata: { completeness, ...(inputId && { inputId }) } })
          this.receipt = undefined
        }
      } catch (error) {
        this.failure = error
        this.receipt?.reject(error)
        this.receipt = undefined
      }
    })()
  }

  append(chunks: readonly UIMessageChunk[], completeness: Completeness): Promise<RuntimeMessage> {
    const next = this.pending.then(() => {
      if (this.closed) throw new Error('Message stream is closed')
      if (this.failure) throw this.failure
      return new Promise<RuntimeMessage>((resolve, reject) => {
        const revision = ++this.revision
        this.receipt = { revision, resolve, reject }
        for (const chunk of chunks) this.controller.enqueue(chunk)
        // Step/finish chunks need not emit. A private metadata barrier acknowledges the entire batch.
        this.controller.enqueue({ type: 'message-metadata', messageMetadata: { completeness, revision } })
      })
    })
    this.pending = next
    return next
  }

  async close(): Promise<void> {
    await this.pending.catch(() => {})
    if (!this.closed) {
      this.closed = true
      if (!this.failure) this.controller.close()
    }
    await this.reading
  }
}
