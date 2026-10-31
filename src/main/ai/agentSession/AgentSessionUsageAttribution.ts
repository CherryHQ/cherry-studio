import { aiUsageRecordService, type RecordAiInvocationInput } from '@data/services/AiUsageRecordService'

/** Joins a gateway response with native output without delaying delivery of that response. */
export class AgentSessionUsageAttribution {
  private readonly owners = new Map<string, { messageId: string; sessionId?: string }>()
  private readonly pending = new Map<string, Set<string>>()
  private closed = false

  capture(responseId: string): (input: RecordAiInvocationInput) => void {
    return (input) => {
      const owner = this.owners.get(responseId)
      this.write(input, owner)
      if (!owner && !this.closed) {
        const requests = this.pending.get(responseId) ?? new Set<string>()
        requests.add(input.requestId)
        this.pending.set(responseId, requests)
      }
    }
  }

  bind(responseId: string, messageId: string, sessionId?: string): void {
    const previous = this.owners.get(responseId)
    if (previous && previous.messageId !== messageId)
      throw new Error('Native response already belongs to another message')
    this.owners.set(responseId, { messageId, sessionId })
    for (const requestId of this.pending.get(responseId) ?? [])
      aiUsageRecordService.associateInvocation(requestId, messageId, sessionId)
    this.pending.delete(responseId)
  }

  close(): void {
    this.closed = true
    this.pending.clear()
  }

  private write(input: RecordAiInvocationInput, owner?: { messageId: string; sessionId?: string }): void {
    aiUsageRecordService.recordInvocation({
      ...input,
      context: {
        ...input.context,
        messageRef: owner ? { kind: 'agent-session', id: owner.messageId } : null,
        agentSessionId: owner?.sessionId ?? input.context.agentSessionId
      }
    })
  }
}
