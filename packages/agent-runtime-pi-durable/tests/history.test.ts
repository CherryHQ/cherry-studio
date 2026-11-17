import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson, type JsonRepresentation } from '@earendil-works/chord/json'
import { createModels } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { encodeEntry } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'

import { readFacts } from '../src/behavior/history'

const encoded = (...args: Parameters<typeof encodeEntry>) =>
  copyJson(encodeEntry(...args)) as JsonRepresentation<ReturnType<typeof encodeEntry>>

// A desktop fork retains model history without acquiring its ancestor's goals or child-control authority.
it('keeps inherited context separate from conversation-owned behavior records', async () => {
  const context = BACKGROUND_CONTEXT
  const native = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context
  )
  try {
    const parent = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
    const boundary = await native.commit(async (tx) => {
      await tx.appendEntry(parent.id, {
        kind: 'proof',
        model: [{ role: 'user', content: 'Retained context', timestamp: 1 }]
      })
      await tx.appendEntry(
        parent.id,
        encoded({ type: 'subagent-user-stop', value: { sessionId: runtimeId('999'), run: 1, at: 1 } }, 'parent-stop')
      )
      return tx.appendEntry(
        parent.id,
        encoded(
          {
            type: 'goal',
            value: {
              id: 'parent-goal',
              revision: 1,
              objective: 'Parent only',
              phase: 'active',
              roundsStarted: 1,
              progressRounds: 0,
              maxGoalRounds: 10,
              tokensUsed: 0,
              costUsed: 0,
              wrapUpDone: false,
              armed: true,
              createdAt: 1,
              updatedAt: 1
            }
          },
          'parent-goal'
        )
      )
    }, context)
    const fork = await parent.fork(boundary.id, { ownership: { kind: 'ownerless' } }, context)
    await native.commit(
      (tx) => tx.appendEntry(fork.id, encoded({ type: 'turn-stop', value: { cause: 'user', at: 2 } }, 'fork-stop')),
      context
    )
    const facts = await native.commit((tx) => readFacts(tx, fork.id), context)
    expect(facts.lineage).toEqual({ kind: 'root' })
    expect(facts.history.filter((entry) => entry.kind === 'user').map((entry) => entry.text)).toEqual([
      'Retained context'
    ])
    expect(facts.history.filter((entry) => entry.kind === 'record').map((entry) => entry.record)).toEqual([
      { type: 'turn-stop', value: { cause: 'user', at: 2 } }
    ])
    expect([...facts.keysSeen]).toEqual(['fork-stop'])
    const original = await native.commit((tx) => readFacts(tx, parent.id), context)
    expect(original.history.filter((entry) => entry.kind === 'record')).toHaveLength(2)
  } finally {
    await native.close(context)
  }
})
