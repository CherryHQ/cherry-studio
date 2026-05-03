import type { Message } from '@shared/data/types/message'

/**
 * Queue of follow-up messages injected mid-stream by
 * `AiStreamManager.injectMessage`.
 *
 * Supports three consumption modes:
 * - `drain()`: batch drain used by agentLoop between outer iterations
 * - AsyncIterable: streaming consumption for Claude Code's `query.streamInput()`
 * - list / remove / reorder: UI-driven queue management
 */
export class PendingMessageQueue {
  private messages: Message[] = []
  private waitResolve?: (message: Message) => void
  private closed = false

  // ── Push ──
  push(message: Message): boolean {
    if (this.closed) return false
    if (this.waitResolve) {
      // Someone is awaiting next() — deliver immediately
      this.waitResolve(message)
      this.waitResolve = undefined
    } else {
      this.messages.push(message)
    }
    return true
  }

  // ── Batch drain (for agentLoop outer loop) ──

  drain(): Message[] {
    const drained = this.messages
    this.messages = []
    return drained
  }

  hasPending(): boolean {
    return this.messages.length > 0
  }

  // ── Queue management (for UI) ──

  /** View current pending messages (readonly snapshot). */
  list(): readonly Message[] {
    return [...this.messages]
  }

  /** Remove a specific message by ID. Returns true if found and removed. */
  remove(messageId: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return false
    this.messages.splice(idx, 1)
    return true
  }

  /** Reorder queue to match the given ID order. IDs not in the queue are ignored. */
  reorder(messageIds: string[]): void {
    const byId = new Map(this.messages.map((m) => [m.id, m]))
    const reordered: Message[] = []
    for (const id of messageIds) {
      const msg = byId.get(id)
      if (msg) {
        reordered.push(msg)
        byId.delete(id)
      }
    }
    // Append any remaining messages not in the order list
    for (const msg of byId.values()) {
      reordered.push(msg)
    }
    this.messages = reordered
  }

  // ── AsyncIterable (for Claude Code's injectedMessageSource → query.streamInput) ──

  /** Stop the async iterator. No more messages will be yielded. */
  close(): void {
    this.closed = true
    if (this.waitResolve) {
      // Unblock any waiting next() — will see closed flag
      this.waitResolve(null as unknown as Message)
      this.waitResolve = undefined
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Message> {
    return {
      next: () => {
        // If there are buffered messages, yield immediately
        if (this.messages.length > 0) {
          return Promise.resolve({ value: this.messages.shift()!, done: false })
        }
        // If closed, signal completion
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as Message, done: true })
        }
        // Wait for the next push()
        return new Promise<IteratorResult<Message>>((resolve) => {
          this.waitResolve = (message: Message) => {
            if (this.closed) {
              resolve({ value: undefined as unknown as Message, done: true })
            } else {
              resolve({ value: message, done: false })
            }
          }
        })
      }
    }
  }
}
