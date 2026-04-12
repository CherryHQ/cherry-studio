import type { Message } from '@shared/data/types/message'

/**
 * Queue for steering messages injected mid-stream.
 *
 * Accepts `Message` (the SQLite entity returned by `messageService.create`)
 * since steering messages are persisted before being queued.
 *
 * - Inner loop (prepareStep): drains between ToolLoopAgent steps.
 * - Outer loop (agentLoop): drains after inner loop exits, decides whether to restart.
 */
export class PendingMessageQueue {
  private messages: Message[] = []

  push(message: Message): void {
    this.messages.push(message)
  }

  drain(): Message[] {
    const drained = this.messages
    this.messages = []
    return drained
  }

  hasPending(): boolean {
    return this.messages.length > 0
  }
}
