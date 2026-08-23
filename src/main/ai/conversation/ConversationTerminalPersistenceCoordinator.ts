import type { ConversationEffectId } from '@shared/ai/conversation'

import type { ConversationTerminalPersistenceResult, PersistConversationTerminalEffect } from './conversationPorts'
import { ConversationTerminalPersistenceResultKind } from './conversationPorts'

interface TerminalPersistenceRecord {
  readonly effect: PersistConversationTerminalEffect
  readonly persist: () => Promise<ConversationTerminalPersistenceResult>
  readonly publish: (result: ConversationTerminalPersistenceResult) => void
  run?: Promise<void>
}

/** The only retry/single-flight owner for Conversation terminal descriptors. */
export class ConversationTerminalPersistenceCoordinator {
  private readonly records = new Map<ConversationEffectId, TerminalPersistenceRecord>()

  submit(
    effect: PersistConversationTerminalEffect,
    persist: () => Promise<ConversationTerminalPersistenceResult>,
    publish: (result: ConversationTerminalPersistenceResult) => void
  ): void {
    if (this.records.has(effect.effectId)) return
    const record: TerminalPersistenceRecord = { effect, persist, publish }
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

  inFlightOperations(): ReadonlyArray<{ id: ConversationEffectId; run: Promise<void> }> {
    return [...this.records].flatMap(([id, record]) => (record.run ? [{ id, run: record.run }] : []))
  }

  private run(record: TerminalPersistenceRecord, abandonOnFailure: boolean): Promise<void> {
    if (record.run) {
      return abandonOnFailure
        ? record.run.then(async () => {
            if (this.records.has(record.effect.effectId)) await this.run(record, true)
          })
        : record.run
    }
    const run = Promise.resolve()
      .then(() => record.persist())
      .then((result) => {
        if (this.records.get(record.effect.effectId) !== record) return
        if (result.kind === ConversationTerminalPersistenceResultKind.Failed && !abandonOnFailure) {
          record.publish(result)
          return
        }
        this.records.delete(record.effect.effectId)
        record.publish(
          result.kind === ConversationTerminalPersistenceResultKind.Failed
            ? { kind: ConversationTerminalPersistenceResultKind.Abandoned, error: result.error }
            : result
        )
      })
      .finally(() => {
        if (record.run === run) record.run = undefined
      })
    record.run = run
    return run
  }
}
