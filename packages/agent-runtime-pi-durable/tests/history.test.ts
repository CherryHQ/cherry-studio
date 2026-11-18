import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson, type JsonRepresentation } from '@earendil-works/chord/json'
import { createModels } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry, type Tx } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { encodeEntry } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'

import { readFacts, type LineageCache } from '../src/behavior/history'

const encoded = (...args: Parameters<typeof encodeEntry>) =>
  copyJson(encodeEntry(...args)) as JsonRepresentation<ReturnType<typeof encodeEntry>>

function counting(tx: Tx, count: (entries: number) => void): Tx {
  return new Proxy(tx, {
    get(target, key) {
      if (key === 'scanEntries')
        return async (...args: Parameters<Tx['scanEntries']>) => {
          const page = await target.scanEntries(...args)
          count(page.items.length)
          return page
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

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
    const facts = await native.commit((tx) => readFacts(tx, fork.id, new Map()), context)
    expect(facts.lineage).toEqual({ kind: 'root' })
    expect(facts.history.filter((entry) => entry.kind === 'user').map((entry) => entry.text)).toEqual([
      'Retained context'
    ])
    expect(facts.history.filter((entry) => entry.kind === 'record').map((entry) => entry.record)).toEqual([
      { type: 'turn-stop', value: { cause: 'user', at: 2 } }
    ])
    expect([...facts.keysSeen]).toEqual(['fork-stop'])
    const original = await native.commit((tx) => readFacts(tx, parent.id, new Map()), context)
    expect(original.history.filter((entry) => entry.kind === 'record')).toHaveLength(2)
  } finally {
    await native.close(context)
  }
})

// Catches a warm lineage cache that rereads, drops or repeats entries, or lets stripped media change the facts.
it('extends cached lineage with only newer entries and reads the same facts as a cold cache', async () => {
  const context = BACKGROUND_CONTEXT
  const native = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context
  )
  try {
    const conversation = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
    const append = (from: number, count: number) =>
      native.commit(async (tx) => {
        const entries = []
        for (let index = from; index < from + count; index++)
          entries.push(
            await tx.appendEntry(conversation.id, {
              kind: 'proof',
              model: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: `before-${index}` },
                    { type: 'image', data: 'iVBORw0KGgo='.repeat(64), mimeType: 'image/png' },
                    { type: 'text', text: `after-${index}` }
                  ],
                  timestamp: index
                }
              ]
            })
          )
        return entries
      }, context)
    const texts = (count: number) => Array.from({ length: count }, (_, index) => `before-${index}\nafter-${index}`)
    const boundary = (await append(0, 40)).at(-1)!
    const lineage: LineageCache = new Map()
    await native.commit((tx) => readFacts(tx, conversation.id, lineage), context)
    await append(40, 2)

    let scanned = 0
    const warm = await native.commit(
      (tx) =>
        readFacts(
          counting(tx, (count) => (scanned += count)),
          conversation.id,
          lineage
        ),
      context
    )
    expect(scanned).toBe(2)
    expect(warm).toEqual(await native.commit((tx) => readFacts(tx, conversation.id, new Map()), context))
    expect(warm.history.flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []))).toEqual(texts(42))

    const earlier = await native.commit(
      (tx) => readFacts(tx, conversation.id, lineage, new Set(), boundary.id),
      context
    )
    expect(earlier.history.flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []))).toEqual(texts(40))
  } finally {
    await native.close(context)
  }
})
