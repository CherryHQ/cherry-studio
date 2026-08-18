import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('StreamAttachmentService')

export class StreamAttachmentService {
  readonly #ownerCounts = new Map<string, number>()

  acquire(topicId: string): () => void {
    this.#ownerCounts.set(topicId, (this.#ownerCounts.get(topicId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.#ownerCounts.get(topicId) ?? 0
      if (count > 1) {
        this.#ownerCounts.set(topicId, count - 1)
        return
      }
      this.#ownerCounts.delete(topicId)
      if (count === 1) {
        void ipcApi
          .request('ai.stream.detach', { topicId })
          .catch((error) => logger.warn('streamDetach failed', { topicId, error }))
      }
    }
  }
}

export const streamAttachmentService = new StreamAttachmentService()
