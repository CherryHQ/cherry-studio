import { AsyncLocalStorage } from 'node:async_hooks'

import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('ProfileWriteBarrierService')

interface ActiveWrite {
  readonly id: string
  readonly label: string
  readonly startedAt: number
  readonly settled: Promise<void>
}

interface WriteContext {
  readonly leaseId: string
  readonly label: string
  active: boolean
  pendingOperations: number
  readonly idleWaiters: Set<() => void>
}

interface AdmissionWaiter {
  readonly label: string
  readonly resolve: (lease: ProfileWriteLease) => void
  readonly reject: (error: Error) => void
}

export interface ProfileWriteLease extends Disposable {
  readonly id: string
  readonly label: string
}

/**
 * Process-wide admission and drain boundary for writes that mutate the active
 * profile. Backup can pause admission, drain leases admitted before the pause,
 * then capture the database and managed files from one stable point in time.
 */
@Injectable('ProfileWriteBarrierService')
@ServicePhase(Phase.BeforeReady)
export class ProfileWriteBarrierService extends BaseService {
  private readonly writeContext = new AsyncLocalStorage<WriteContext>()
  private readonly activeWrites = new Map<string, ActiveWrite>()
  private readonly pauseHolds = new Set<symbol>()
  private readonly admissionQueue: AdmissionWaiter[] = []
  private nextLeaseId = 0
  private shuttingDown = false

  /** True while backup (or shutdown) has closed admission for new top-level writes. */
  public get isWriteQuiesced(): boolean {
    return this.shuttingDown || this.pauseHolds.size > 0
  }

  /**
   * Wait for admission, then acquire a write lease before performing any I/O.
   * Paused callers queue without joining the in-flight drain set. Calls made
   * inside runWrite() share the outer lease and extend its lifetime.
   */
  public async acquireWriteLease(label: string): Promise<ProfileWriteLease> {
    const inherited = this.writeContext.getStore()
    if (inherited?.active) {
      inherited.pendingOperations++
      return this.createNestedLease(inherited, label)
    }

    if (this.shuttingDown) {
      throw this.shutdownError()
    }
    if (this.pauseHolds.size > 0) {
      return new Promise<ProfileWriteLease>((resolve, reject) => {
        this.admissionQueue.push({ label, resolve, reject })
      })
    }

    return this.createTopLevelLease(label)
  }

  private createTopLevelLease(label: string): ProfileWriteLease {
    const id = `profile-write-${++this.nextLeaseId}`
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const activeWrite: ActiveWrite = {
      id,
      label,
      startedAt: Date.now(),
      settled
    }
    this.activeWrites.set(id, activeWrite)

    let disposed = false
    return {
      id,
      label,
      dispose: () => {
        if (disposed) return
        disposed = true
        this.activeWrites.delete(id)
        settle()
      }
    }
  }

  /**
   * Run a profile mutation under a lease. AsyncLocalStorage makes nested
   * service calls reentrant: one DataApi request that reaches PreferenceService
   * remains one drainable write instead of trying to re-enter a closed gate.
   */
  public async runWrite<T>(label: string, operation: () => T | Promise<T>): Promise<T> {
    const inherited = this.writeContext.getStore()
    if (inherited?.active) {
      return this.runInContext(inherited, operation)
    }

    const lease = await this.acquireWriteLease(label)
    const context: WriteContext = {
      leaseId: lease.id,
      label: lease.label,
      active: true,
      pendingOperations: 0,
      idleWaiters: new Set()
    }

    let result!: T
    let failed = false
    let failure: unknown
    try {
      result = await this.writeContext.run(context, () => this.runInContext(context, operation))
    } catch (error) {
      failed = true
      failure = error
    }

    try {
      await this.waitUntilContextIdle(context)
    } finally {
      context.active = false
      lease.dispose()
    }

    if (failed) {
      throw failure
    }
    return result
  }

  /**
   * Close admission until this hold is disposed. Holds compose; only releasing
   * the final hold reopens admission. A lost hold deliberately fails closed.
   */
  public pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'profile-write-barrier-pause')
    this.pauseHolds.add(token)
    logger.info('Profile writes paused', { reason: reason ?? null, holds: this.pauseHolds.size })

    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('Profile write pause hold released', { reason: reason ?? null, holds: this.pauseHolds.size })
        if (this.pauseHolds.size === 0) {
          this.releaseAdmissionQueue()
        }
      }
    }
  }

  /**
   * Wait for every write admitted before pause to settle. Never aborts a
   * straggler; the backup coordinator decides whether a timeout is fatal.
   */
  public async drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    if (!this.isWriteQuiesced) {
      logger.warn('drainInFlight called without an active pause hold — the verdict is a point-in-time snapshot')
    }

    const seen = new WeakSet<Promise<void>>()
    const pending = new Map<Promise<void>, string>()
    const collect = (): void => {
      for (const write of this.activeWrites.values()) {
        if (seen.has(write.settled)) continue
        seen.add(write.settled)
        pending.set(write.settled, write.id)
        void write.settled.then(() => pending.delete(write.settled))
      }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), Math.max(0, options.timeoutMs))
    })

    try {
      for (;;) {
        collect()
        if (pending.size === 0) {
          return { stragglerIds: [] }
        }

        const winner = await Promise.race([
          Promise.allSettled([...pending.keys()]).then(() => 'done' as const),
          timeout
        ])
        if (winner === 'timeout') {
          const stragglerIds = [...new Set(pending.values())]
          logger.warn('Profile write drain timed out with unsettled work', {
            timeoutMs: options.timeoutMs,
            stragglerIds
          })
          return { stragglerIds }
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /** Advisory, read-only diagnostics for backup preflight and timeout reports. */
  public listActiveWork(): Array<{ id: string; summary: string }> {
    const now = Date.now()
    return [...this.activeWrites.values()].map((write) => ({
      id: write.id,
      summary: `${write.label} ageMs=${Math.max(0, now - write.startedAt)}`
    }))
  }

  /** Permanently close admission for this lifecycle run. Existing leases may settle normally. */
  public shutdown(): void {
    if (this.shuttingDown) return
    this.shuttingDown = true
    const queuedWrites = this.admissionQueue.splice(0)
    const error = this.shutdownError()
    for (const waiter of queuedWrites) {
      waiter.reject(error)
    }
    logger.info('Profile write barrier shut down', {
      activeWrites: this.activeWrites.size,
      rejectedQueuedWrites: queuedWrites.length
    })
  }

  protected onInit(): void {
    this.shuttingDown = false
    this.pauseHolds.clear()
  }

  protected onStop(): void {
    this.shutdown()
  }

  private shutdownError(): Error {
    return new Error('Profile writes are unavailable during shutdown')
  }

  private releaseAdmissionQueue(): void {
    if (this.shuttingDown || this.pauseHolds.size > 0 || this.admissionQueue.length === 0) return

    const queuedWrites = this.admissionQueue.splice(0)
    for (const waiter of queuedWrites) {
      waiter.resolve(this.createTopLevelLease(waiter.label))
    }
    logger.info('Queued profile writes admitted', { count: queuedWrites.length })
  }

  private createNestedLease(context: WriteContext, label: string): ProfileWriteLease {
    let disposed = false
    return {
      id: context.leaseId,
      label,
      dispose: () => {
        if (disposed) return
        disposed = true
        this.completeContextOperation(context)
      }
    }
  }

  private async runInContext<T>(context: WriteContext, operation: () => T | Promise<T>): Promise<T> {
    context.pendingOperations++
    try {
      return await operation()
    } finally {
      this.completeContextOperation(context)
    }
  }

  private completeContextOperation(context: WriteContext): void {
    context.pendingOperations--
    if (context.pendingOperations !== 0) return

    for (const resolve of context.idleWaiters) {
      resolve()
    }
    context.idleWaiters.clear()
  }

  private async waitUntilContextIdle(context: WriteContext): Promise<void> {
    if (context.pendingOperations === 0) return
    await new Promise<void>((resolve) => context.idleWaiters.add(resolve))
  }
}
