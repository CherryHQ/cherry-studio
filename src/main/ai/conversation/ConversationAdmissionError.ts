import type { ConversationAdmissionReason } from '@shared/ai/conversation'

export class ConversationAdmissionError extends Error {
  constructor(readonly reason: ConversationAdmissionReason) {
    super(reason)
    this.name = 'ConversationAdmissionError'
  }
}
