export enum OwnedOperationPhase {
  Retained = 'retained',
  Executing = 'executing'
}

export enum OwnedOperationAttemptDisposition {
  Retain = 'retain',
  Complete = 'complete',
  Abandon = 'abandon'
}

export interface OwnedOperationHandle<TId> {
  readonly id: TId
  readonly completed: Promise<OwnedOperationAttemptDisposition>
}

export interface OwnedOperationAttempt<TId> {
  readonly operation: OwnedOperationHandle<TId>
  readonly completed: Promise<void>
}

interface OperationRecord<TId> {
  readonly handle: OwnedOperationHandle<TId>
  readonly resolve: (disposition: OwnedOperationAttemptDisposition) => void
  attempt?: AttemptRecord<TId>
}

interface AttemptRecord<TId> {
  readonly attempt: OwnedOperationAttempt<TId>
  readonly resolve: () => void
}

/** Tracks a business obligation independently from the Promise for its current attempt. */
export class OwnedOperationRegistry<TId> {
  private readonly records = new Map<TId, OperationRecord<TId>>()

  open(id: TId): OwnedOperationHandle<TId> {
    if (this.records.has(id)) throw new Error(`Operation is already open: ${String(id)}`)
    const completion = Promise.withResolvers<OwnedOperationAttemptDisposition>()
    const handle: OwnedOperationHandle<TId> = { id, completed: completion.promise }
    this.records.set(id, { handle, resolve: completion.resolve })
    return handle
  }

  beginAttempt(handle: OwnedOperationHandle<TId>): OwnedOperationAttempt<TId> {
    const record = this.current(handle)
    if (!record) throw new Error(`Operation is not open: ${String(handle.id)}`)
    if (record.attempt) throw new Error(`Operation already has an active attempt: ${String(handle.id)}`)
    const completion = Promise.withResolvers<void>()
    const attempt: OwnedOperationAttempt<TId> = { operation: handle, completed: completion.promise }
    record.attempt = { attempt, resolve: completion.resolve }
    return attempt
  }

  settleAttempt(attempt: OwnedOperationAttempt<TId>, disposition: OwnedOperationAttemptDisposition): boolean {
    const record = this.current(attempt.operation)
    if (!record || record.attempt?.attempt !== attempt) return false
    record.attempt.resolve()
    record.attempt = undefined
    if (disposition !== OwnedOperationAttemptDisposition.Retain) this.close(record, disposition)
    return true
  }

  settle(
    handle: OwnedOperationHandle<TId>,
    disposition: OwnedOperationAttemptDisposition.Complete | OwnedOperationAttemptDisposition.Abandon
  ): boolean {
    const record = this.current(handle)
    if (!record || record.attempt) return false
    this.close(record, disposition)
    return true
  }

  phase(handle: OwnedOperationHandle<TId>): OwnedOperationPhase | undefined {
    const record = this.current(handle)
    if (!record) return undefined
    return record.attempt ? OwnedOperationPhase.Executing : OwnedOperationPhase.Retained
  }

  openOperations(): readonly OwnedOperationHandle<TId>[] {
    return [...this.records.values()].map(({ handle }) => handle)
  }

  activeAttempts(): readonly OwnedOperationAttempt<TId>[] {
    return [...this.records.values()].flatMap(({ attempt }) => (attempt ? [attempt.attempt] : []))
  }

  private current(handle: OwnedOperationHandle<TId>): OperationRecord<TId> | undefined {
    const record = this.records.get(handle.id)
    return record?.handle === handle ? record : undefined
  }

  private close(record: OperationRecord<TId>, disposition: OwnedOperationAttemptDisposition): void {
    this.records.delete(record.handle.id)
    record.resolve(disposition)
  }
}
