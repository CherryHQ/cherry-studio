import { aiUsageRecordService, type RecordAiInvocationInput } from '@data/services/AiUsageRecordService'

/** Joins a gateway response with native output without delaying delivery of that response. */
export class AgentSessionUsageAttribution {
  private readonly owners = new Map<string, { messageId: string; ready: () => boolean }>()
  private readonly pending = new Map<string, Set<string>>()
  private closed = false

  capture(responseId: string): (input: RecordAiInvocationInput) => void {
    return (input) => {
      const owner = this.owners.get(responseId)
      const ready = owner?.ready() === true
      this.write(input, ready ? owner : undefined)
      if (!ready && !this.closed) {
        const requests = this.pending.get(responseId) ?? new Set<string>()
        requests.add(input.requestId)
        this.pending.set(responseId, requests)
      }
    }
  }

  bind(responseId: string, messageId: string, ready = () => true): void {
    const previous = this.owners.get(responseId)
    if (previous && previous.messageId !== messageId)
      throw new Error('Native response already belongs to another message')
    this.owners.set(responseId, { messageId, ready })
    this.flush(messageId)
  }

  flush(messageId: string): void {
    for (const [responseId, requests] of this.pending) {
      const owner = this.owners.get(responseId)
      if (owner?.messageId !== messageId || !owner.ready()) continue
      for (const requestId of requests) aiUsageRecordService.associateInvocation(requestId, messageId)
      this.pending.delete(responseId)
    }
  }

  close(): void {
    this.closed = true
    this.pending.clear()
  }

  private write(input: RecordAiInvocationInput, owner?: { messageId: string }): void {
    aiUsageRecordService.recordInvocation({
      ...input,
      context: {
        ...input.context,
        messageRef: owner ? { kind: 'agent-session', id: owner.messageId } : null
      }
    })
  }
}
