import { aiUsageRecordService, type RecordAiInvocationInput } from '@data/services/AiUsageRecordService'

/** Joins a gateway response with native output without delaying delivery of that response. */
export class AgentSessionUsageAttribution {
  private readonly owners = new Map<string, string>()
  private readonly pending = new Map<string, RecordAiInvocationInput[]>()
  private closed = false

  capture(responseId: string): (input: RecordAiInvocationInput) => void {
    return (input) => {
      const owner = this.owners.get(responseId)
      if (owner || this.closed) this.write(input, owner)
      else this.pending.set(responseId, [...(this.pending.get(responseId) ?? []), input])
    }
  }

  bind(responseId: string, messageId: string): void {
    const previous = this.owners.get(responseId)
    if (previous && previous !== messageId) throw new Error('Native response already belongs to another message')
    this.owners.set(responseId, messageId)
    for (const input of this.pending.get(responseId) ?? []) this.write(input, messageId)
    this.pending.delete(responseId)
  }

  close(): void {
    this.closed = true
    for (const inputs of this.pending.values()) for (const input of inputs) this.write(input)
    this.pending.clear()
  }

  private write(input: RecordAiInvocationInput, messageId?: string): void {
    aiUsageRecordService.recordInvocation({
      ...input,
      context: {
        ...input.context,
        messageRef: messageId ? { kind: 'agent-session', id: messageId } : null
      }
    })
  }
}
