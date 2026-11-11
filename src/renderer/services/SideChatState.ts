import type { SerializedError } from '@renderer/types/error'
import type { CacheComposerDraftBase } from '@shared/data/cache/cacheValueTypes'
import type { SideChatSource } from '@shared/data/types/sideChat'
import type { SideChatView } from '@shared/ipc/schemas/sideChat'

export interface PendingSideChatDraft extends CacheComposerDraftBase {
  key: string
  topicId?: string
  busy: boolean
  error?: SerializedError
}

/** Window-only state; deleted revisions outlive their content to reject late responses. */
export class SideChatState {
  private revisions = new Map<string, number>()
  private views = new Map<string, SideChatView>()
  private drafts = new Map<string, string>()
  private pendingDrafts = new WeakMap<SideChatSource, PendingSideChatDraft>()
  private composerDrafts = new Map<string, CacheComposerDraftBase>()
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
      this.composerDrafts.delete(topicId)
    }
    this.snapshot = [...this.views.values()]
    this.notify()
  }

  getPendingDraft = (source: SideChatSource) => this.pendingDrafts.get(source)
  initializePendingDraft(source: SideChatSource, create: () => PendingSideChatDraft) {
    if (!this.pendingDrafts.has(source)) this.pendingDrafts.set(source, create())
  }
  updatePendingDraft(source: SideChatSource, patch: Partial<PendingSideChatDraft>) {
    const current = this.pendingDrafts.get(source)
    if (!current) return
    this.pendingDrafts.set(source, { ...current, ...patch })
    this.notify()
  }
  clearPendingDraft(source: SideChatSource) {
    this.pendingDrafts.delete(source)
  }

  getDraft = (topicId: string) => this.drafts.get(topicId) ?? ''
  getComposerDraft = (identity: string | SideChatSource) =>
    typeof identity === 'string' ? this.composerDrafts.get(identity) : this.pendingDrafts.get(identity)
  setComposerDraft(identity: string | SideChatSource, draft: CacheComposerDraftBase) {
    if (typeof identity !== 'string') this.updatePendingDraft(identity, draft)
    else if (this.views.has(identity)) this.composerDrafts.set(identity, draft)
  }
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
