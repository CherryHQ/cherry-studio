import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { type ConversationRef, conversationRefKey } from '@shared/ai/conversation'

const logger = loggerService.withContext('StreamAttachmentService')

export class StreamAttachmentService {
  readonly #ownerCounts = new Map<string, number>()

  acquire(conversation: ConversationRef): () => void {
    const key = conversationRefKey(conversation)
    this.#ownerCounts.set(key, (this.#ownerCounts.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.#ownerCounts.get(key) ?? 0
      if (count > 1) {
        this.#ownerCounts.set(key, count - 1)
        return
      }
      this.#ownerCounts.delete(key)
      if (count === 1) {
        void ipcApi
          .request('ai.stream.detach', { conversation })
          .catch((error) => logger.warn('streamDetach failed', { conversation, error }))
      }
    }
  }
}

export const streamAttachmentService = new StreamAttachmentService()
