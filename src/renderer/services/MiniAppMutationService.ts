class MiniAppMutationService {
  private pending: Promise<unknown> | null = null

  enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = this.pending
    const persisted = previous ? previous.catch(() => undefined).then(mutation) : mutation()
    this.pending = persisted
    persisted.then(
      () => this.clear(persisted),
      () => this.clear(persisted)
    )
    return persisted
  }

  resetForTesting() {
    this.pending = null
  }

  private clear(persisted: Promise<unknown>) {
    if (this.pending === persisted) this.pending = null
  }
}

export const miniAppMutationService = new MiniAppMutationService()
