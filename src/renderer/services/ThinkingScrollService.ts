export interface ThinkingScrollSnapshot {
  scrollTop: number
  following: boolean
  isExpanded: boolean
}

export class ThinkingScrollService {
  private snapshots = new Map<string, ThinkingScrollSnapshot>()

  read(id: string): ThinkingScrollSnapshot | undefined {
    const snapshot = this.snapshots.get(id)
    if (snapshot) {
      this.snapshots.delete(id)
      this.snapshots.set(id, snapshot)
    }
    return snapshot
  }

  write(id: string, snapshot: ThinkingScrollSnapshot): void {
    this.snapshots.delete(id)
    this.snapshots.set(id, { ...snapshot })
    if (this.snapshots.size > 256) this.delete(this.snapshots.keys().next().value!)
  }

  delete(id: string): void {
    this.snapshots.delete(id)
  }

  deleteWhere(matches: (id: string) => boolean): void {
    for (const id of this.snapshots.keys()) if (matches(id)) this.delete(id)
  }

  clear(): void {
    this.snapshots.clear()
  }
}

export const thinkingScrollService = new ThinkingScrollService()
