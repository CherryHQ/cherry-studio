export type ComposerReplyDraft = {
  selectedText: string
  text: string
  sourceMessageId?: string
}

type ReplyDestination = (reply: ComposerReplyDraft) => boolean

class ComposerReplyDraftService {
  private readonly destinations = new Map<string, ReplyDestination>()
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getDestination(tabId: string | null, topicId?: string): ReplyDestination | undefined {
    return topicId ? this.destinations.get(JSON.stringify([tabId, topicId])) : undefined
  }

  register(tabId: string | null, topicId: string, destination: ReplyDestination): () => void {
    const key = JSON.stringify([tabId, topicId])
    this.destinations.set(key, destination)
    this.listeners.forEach((listener) => listener())

    return () => {
      if (this.destinations.get(key) !== destination) return
      this.destinations.delete(key)
      this.listeners.forEach((listener) => listener())
    }
  }
}

export const composerReplyDraftService = new ComposerReplyDraftService()
