import {
  type OwnedOperationAttempt,
  OwnedOperationAttemptDisposition,
  type OwnedOperationHandle,
  OwnedOperationRegistry
} from '@main/core/concurrency/OwnedOperationRegistry'
import type { ConversationEffectId } from '@shared/ai/conversation'

import type { ConversationTerminalPersistenceResult, PersistConversationTerminalEffect } from './conversationPorts'
import { ConversationTerminalPersistenceResultKind } from './conversationPorts'

interface TerminalPersistenceRecord {
  readonly effect: PersistConversationTerminalEffect
  readonly persist: () => Promise<ConversationTerminalPersistenceResult>
  readonly publish: (result: ConversationTerminalPersistenceResult) => void
  readonly operation: OwnedOperationHandle<ConversationEffectId>
  run?: Promise<void>
}

/** The only retry/single-flight owner for Conversation terminal descriptors. */
export class ConversationTerminalPersistenceCoordinator {
  private readonly records = new Map<ConversationEffectId, TerminalPersistenceRecord>()
  private readonly operations = new OwnedOperationRegistry<ConversationEffectId>()

  constructor(private readonly onOperationSettled?: () => void) {}

  submit(
    effect: PersistConversationTerminalEffect,
    persist: () => Promise<ConversationTerminalPersistenceResult>,
    publish: (result: ConversationTerminalPersistenceResult) => void
  ): void {
    if (this.records.has(effect.effectId)) return
    const operation = this.operations.open(effect.effectId)
    const record: TerminalPersistenceRecord = { effect, persist, publish, operation }
    this.records.set(effect.effectId, record)
    void this.run(record, false)
  }

  retryBlocked(): void {
    for (const record of this.records.values()) {
      if (!record.run) void this.run(record, false)
    }
  }

  finalize(effectId: ConversationEffectId): void {
    const record = this.records.get(effectId)
    if (!record) return
    void this.run(record, true)
  }

  inFlightOperations(): ReadonlyArray<{
    id: ConversationEffectId
    run: Promise<OwnedOperationAttemptDisposition>
  }> {
    return this.operations.openOperations().map(({ id, completed }) => ({ id, run: completed }))
  }

  private run(record: TerminalPersistenceRecord, abandonOnFailure: boolean): Promise<void> {
    if (record.run) {
      return abandonOnFailure
        ? record.run.then(async () => {
            if (this.records.has(record.effect.effectId)) await this.run(record, true)
          })
        : record.run
    }
    const attempt = this.operations.beginAttempt(record.operation)
    const run = Promise.resolve()
      .then(() => record.persist())
      .then((result) => {
        if (this.records.get(record.effect.effectId) !== record) return
        if (result.kind === ConversationTerminalPersistenceResultKind.Failed && !abandonOnFailure) {
          record.publish(result)
          this.operations.settleAttempt(attempt, OwnedOperationAttemptDisposition.Retain)
          return
        }
        record.publish(
          result.kind === ConversationTerminalPersistenceResultKind.Failed
            ? { kind: ConversationTerminalPersistenceResultKind.Abandoned, error: result.error }
            : result
        )
        this.records.delete(record.effect.effectId)
        this.operations.settleAttempt(
          attempt,
          result.kind === ConversationTerminalPersistenceResultKind.Failed
            ? OwnedOperationAttemptDisposition.Abandon
            : OwnedOperationAttemptDisposition.Complete
        )
        this.onOperationSettled?.()
      })
      .finally(() => {
        this.retainUnsettledAttempt(attempt)
        if (record.run === run) record.run = undefined
      })
    record.run = run
    return run
  }

  private retainUnsettledAttempt(attempt: OwnedOperationAttempt<ConversationEffectId>): void {
    this.operations.settleAttempt(attempt, OwnedOperationAttemptDisposition.Retain)
  }
}
