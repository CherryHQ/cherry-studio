/**
 * Per-message selection subscriptions for the message list (#19209).
 *
 * The selection ids used to ride the selection context value: one toggle
 * changed the context identity and re-rendered every mounted `MessageFrame`
 * (each recomputing `selectedMessageIds.includes(id)`), plus every consumer of
 * the actions context the controller's selected-dependent callbacks
 * invalidated. This store splits the subscription axes:
 *
 *  - per-id subscribers (`useIsMessageSelected`) are notified only when THAT
 *    id's boolean flips;
 *  - list subscribers (`useSelectedMessageIds`) are notified on any change and
 *    receive a stable array identity between changes (useSyncExternalStore
 *    re-render contract);
 *  - the mode axes (enabled / multi-select) stay on the split mode context,
 *    which only changes when the mode toggles.
 *
 * The store is a mirror, not the source of truth: the controller owns the
 * persisted selection state and calls `replace()` whenever it changes.
 */
export class MessageSelectionStore {
  private selected = new Set<string>()
  private snapshot: readonly string[] = []
  private readonly idListeners = new Map<string, Set<() => void>>()
  private readonly listListeners = new Set<() => void>()

  /** Replace the full selection; notifies only the listeners whose input changed. */
  replace(nextIds: readonly string[]): void {
    const next = new Set(nextIds)
    let changed = false
    for (const id of this.selected) {
      if (!next.has(id)) {
        changed = true
        this.selected.delete(id)
        this.notifyId(id)
      }
    }
    for (const id of next) {
      if (!this.selected.has(id)) {
        changed = true
        this.selected.add(id)
        this.notifyId(id)
      }
    }
    if (changed) {
      this.snapshot = [...this.selected]
      for (const listener of this.listListeners) listener()
    }
  }

  isSelected(id: string): boolean {
    return this.selected.has(id)
  }

  /** Stable identity between changes — required by useSyncExternalStore. */
  getSnapshot(): readonly string[] {
    return this.snapshot
  }

  subscribeId(id: string, listener: () => void): () => void {
    let listeners = this.idListeners.get(id)
    if (!listeners) {
      listeners = new Set()
      this.idListeners.set(id, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.idListeners.delete(id)
    }
  }

  subscribeList(listener: () => void): () => void {
    this.listListeners.add(listener)
    return () => this.listListeners.delete(listener)
  }

  private notifyId(id: string): void {
    const listeners = this.idListeners.get(id)
    if (!listeners) return
    for (const listener of listeners) listener()
  }
}
