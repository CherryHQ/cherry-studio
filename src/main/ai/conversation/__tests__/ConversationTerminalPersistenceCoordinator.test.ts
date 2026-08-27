import {
  ConversationKind,
  ConversationOutcomeKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { describe, expect, it, vi } from 'vitest'

import { OwnedOperationAttemptDisposition } from '../../../core/concurrency/OwnedOperationRegistry'
import {
  ConversationEffectType,
  ConversationTerminalPersistenceCoordinator,
  ConversationTerminalPersistenceResultKind,
  type PersistConversationTerminalEffect
} from '..'

const effect: PersistConversationTerminalEffect = {
  type: ConversationEffectType.PersistTerminal,
  conversation: { kind: ConversationKind.Chat, id: 'topic-1' },
  turnId: toConversationTurnId('turn-1'),
  executionId: toConversationExecutionId('execution-1'),
  effectId: toConversationEffectId('persist-1'),
  outcome: { kind: ConversationOutcomeKind.Success }
}

const failure = {
  kind: ConversationTerminalPersistenceResultKind.Failed,
  error: { name: 'Error', message: 'busy', stack: null }
} as const

describe('ConversationTerminalPersistenceCoordinator', () => {
  it('registers the operation before invoking the persistence port', async () => {
    const coordinator = new ConversationTerminalPersistenceCoordinator()
    let registeredAtInvocation: readonly string[] = []
    const persist = vi.fn(async () => {
      registeredAtInvocation = coordinator.inFlightOperations().map(({ id }) => id)
      return { kind: ConversationTerminalPersistenceResultKind.Durable } as const
    })

    coordinator.submit(effect, persist, vi.fn())
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())

    expect(registeredAtInvocation).toEqual([effect.effectId])
  })

  it('retries the same effect descriptor and publishes durable exactly once', async () => {
    const persist = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ kind: ConversationTerminalPersistenceResultKind.Durable })
    const publish = vi.fn()
    const coordinator = new ConversationTerminalPersistenceCoordinator()

    coordinator.submit(effect, persist, publish)
    const [operation] = coordinator.inFlightOperations()
    expect(operation?.id).toBe(effect.effectId)
    let operationSettled = false
    void operation?.run.then(() => {
      operationSettled = true
    })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(failure))
    await Promise.resolve()
    expect(operationSettled).toBe(false)
    expect(coordinator.inFlightOperations().map(({ id }) => id)).toEqual([effect.effectId])
    coordinator.retryBlocked()
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith({ kind: ConversationTerminalPersistenceResultKind.Durable })
    )

    expect(persist).toHaveBeenCalledTimes(2)
    await expect(operation?.run).resolves.toBe(OwnedOperationAttemptDisposition.Complete)
    expect(coordinator.inFlightOperations()).toEqual([])
  })

  it('turns an exact failed Stop retry into deferred recovery', async () => {
    const persist = vi.fn().mockResolvedValue(failure)
    const publish = vi.fn()
    const coordinator = new ConversationTerminalPersistenceCoordinator()

    coordinator.submit(effect, persist, publish)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    coordinator.finalize(effect.effectId)
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith({
        kind: ConversationTerminalPersistenceResultKind.Abandoned,
        error: failure.error
      })
    )

    expect(persist).toHaveBeenCalledTimes(2)
  })
})
