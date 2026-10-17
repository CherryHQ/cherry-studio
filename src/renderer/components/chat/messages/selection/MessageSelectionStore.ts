// Selection subscriptions read the authoritative source, with no effect-driven mirror.
export class MessageSelectionStore {
  constructor(
    private readonly readIds: () => readonly string[],
    private readonly subscribe: (listener: () => void) => () => void
  ) {}

  isSelected(id: string): boolean {
    return this.readIds().includes(id)
  }

  getSnapshot(): readonly string[] {
    return this.readIds()
  }

  subscribeId(id: string, listener: () => void): () => void {
    let selected = this.isSelected(id)
    return this.subscribe(() => {
      const next = this.isSelected(id)
      if (next === selected) return
      selected = next
      listener()
    })
  }

  subscribeList(listener: () => void): () => void {
    return this.subscribe(listener)
  }
}
