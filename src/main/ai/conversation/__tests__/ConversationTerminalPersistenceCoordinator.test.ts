import {
  ConversationKind,
  ConversationOutcomeKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { describe, expect, it, vi } from 'vitest'

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
  it('retries the same effect descriptor and publishes durable exactly once', async () => {
    const persist = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ kind: ConversationTerminalPersistenceResultKind.Durable })
    const publish = vi.fn()
    const coordinator = new ConversationTerminalPersistenceCoordinator()

    coordinator.submit(effect, persist, publish)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(failure))
    coordinator.retryBlocked()
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith({ kind: ConversationTerminalPersistenceResultKind.Durable })
    )

    expect(persist).toHaveBeenCalledTimes(2)
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
