import { AsyncLocalStorage } from 'node:async_hooks'

import { Mutex } from 'async-mutex'

/**
 * Coordinates operations that mutate both the profile database and managed
 * profile files with a whole-profile snapshot. Ordinary mutations remain
 * concurrent; a snapshot waits for mutations already in flight, then prevents
 * new ones from starting until its callback has captured both stores.
 *
 * Callers must cover the complete DB↔filesystem mutation, not just one side of
 * it. Otherwise the barrier cannot establish a consistent snapshot boundary.
 */
export class ProfileMutationBarrier {
  private readonly snapshotMutex = new Mutex()
  private readonly mutationContext = new AsyncLocalStorage<{ active: boolean }>()
  private activeMutations = 0
  private snapshotPending = false
  private mutationGate: Promise<void> = Promise.resolve()
  private openMutationGate: (() => void) | null = null
  private mutationDrain: Promise<void> = Promise.resolve()
  private resolveMutationDrain: (() => void) | null = null

  async acquireMutation(): Promise<() => void> {
    while (this.snapshotPending) await this.mutationGate

    if (this.activeMutations === 0) {
      this.mutationDrain = new Promise<void>((resolve) => {
        this.resolveMutationDrain = resolve
      })
    }
    this.activeMutations += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeMutations -= 1
      if (this.activeMutations === 0) {
        this.resolveMutationDrain?.()
        this.resolveMutationDrain = null
      }
    }
  }

  async runMutation<T>(task: () => T | Promise<T>): Promise<T> {
    // Owner operations compose (for example Knowledge restore → create base →
    // per-base mutation lock). Re-acquiring after a snapshot became pending
    // would deadlock: the snapshot waits for the outer lease while the inner
    // call waits for the snapshot. Async-local ownership makes nesting one lease.
    if (this.mutationContext.getStore()?.active) return await task()

    const release = await this.acquireMutation()
    const context = { active: true }
    try {
      return await this.mutationContext.run(context, task)
    } finally {
      // Detached descendants inherit the object, but not an immortal lease.
      context.active = false
      release()
    }
  }

  async runSnapshot<T>(task: () => T | Promise<T>): Promise<T> {
    if (this.mutationContext.getStore()?.active) {
      throw new Error('ProfileMutationBarrier cannot start a snapshot inside a managed mutation')
    }
    return this.snapshotMutex.runExclusive(async () => {
      this.snapshotPending = true
      this.mutationGate = new Promise<void>((resolve) => {
        this.openMutationGate = resolve
      })
      try {
        if (this.activeMutations > 0) await this.mutationDrain
        return await task()
      } finally {
        this.snapshotPending = false
        this.openMutationGate?.()
        this.openMutationGate = null
      }
    })
  }
}

/** Process-wide boundary shared by managed-resource owners and profile export. */
export const profileMutationBarrier = new ProfileMutationBarrier()
