import type { SideChatView } from '@shared/ipc/schemas/sideChat'

/** Window-only state; deleted revisions outlive their content to reject late responses. */
export class SideChatState {
  private revisions = new Map<string, number>()
  private views = new Map<string, SideChatView>()
  private drafts = new Map<string, string>()
  private listeners = new Set<() => void>()
  private snapshot: readonly SideChatView[] = []

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  apply(topicId: string, revision: number, view: SideChatView | null) {
    if (revision <= (this.revisions.get(topicId) ?? -1)) return
    this.revisions.set(topicId, revision)
    if (view) this.views.set(topicId, view)
    else {
      this.views.delete(topicId)
      this.drafts.delete(topicId)
    }
    this.snapshot = [...this.views.values()]
    this.notify()
  }

  getDraft = (topicId: string) => this.drafts.get(topicId) ?? ''
  setDraft(topicId: string, text: string) {
    if (text) this.drafts.set(topicId, text)
    else this.drafts.delete(topicId)
    this.notify()
  }

  clearSubmittedDraft(topicId: string, submitted: string) {
    if (this.getDraft(topicId) === submitted) this.setDraft(topicId, '')
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
