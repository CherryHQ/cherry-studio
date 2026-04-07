import type { UIMessage } from 'ai'

/**
 * Queue for steering messages injected mid-stream.
 *
 * - Inner loop (prepareStep): drains between ToolLoopAgent steps.
 * - Outer loop (agentLoop): drains after inner loop exits, decides whether to restart.
 */
export class PendingMessageQueue {
  private messages: UIMessage[] = []

  push(message: UIMessage): void {
    this.messages.push(message)
  }

  drain(): UIMessage[] {
    const drained = this.messages
    this.messages = []
    return drained
  }

  hasPending(): boolean {
    return this.messages.length > 0
  }
}
