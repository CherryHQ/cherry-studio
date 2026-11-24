import { isDeepStrictEqual } from 'node:util'

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { ConversationId, Tx } from '@earendil-works/pi-durable'
import { afterAll, describe, expect, it } from 'vitest'

import { harnessContract, type Key } from '@cherrystudio/agent-behavior'

import { DurableFolds, pages, readFacts, threadId, type HistoryFold } from '../src/behavior/history'
import { countingTx, openDurableHarness, type ReadCounts } from './behaviorHarness'

/** Compares every warm fold with one rebuilt from empty in the same transaction. */
class CheckedFolds extends DurableFolds {
  checks = 0
  readonly mismatches: ConversationId[] = []

  override async advance(tx: Tx, id: ConversationId): Promise<HistoryFold> {
    const warm = await super.advance(tx, id)
    const cold = await new DurableFolds().advance(tx, id)
    this.checks++
    if (!isDeepStrictEqual(warm, cold)) this.mismatches.push(id)
    return warm
  }
}

const unavailable = (test: (typeof harnessContract)[number]) =>
  test.needs.some((need) => need === 'context-filter' || need === 'foreground-continuation')

// Catches incremental fold state that drifts from a rebuild in any behavior the contract drives.
describe('Durable facts folds equal a rebuild at every read', () => {
  let checks = 0
  afterAll(() => {
    expect(checks).toBeGreaterThan(0)
  })
  for (const test of harnessContract)
    (unavailable(test) ? it.skip : it)(
      test.name,
      async () => {
        const folds: CheckedFolds[] = []
        await test.run(
          async (install) =>
            (
              await openDurableHarness(install, [], {
                folds: () => {
                  const value = new CheckedFolds()
                  folds.push(value)
                  return value
                }
              })
            ).harness
        )
        checks += folds.reduce((total, value) => total + value.checks, 0)
        expect(folds.flatMap((value) => value.mismatches)).toEqual([])
      },
      20000
    )
})

// Catches a facts read or child path whose cost grows with folded history instead of with new rows.
it('reads only unseen rows on repeated facts reads and on the child answer and stop paths', async () => {
  let opened!: Awaited<ReturnType<typeof openDurableHarness>>
  let folds!: DurableFolds
  await harnessContract
    .find((test) => test.name === 'children report running and per-run usage from their own entries')!
    .run(async (install) => {
      opened = await openDurableHarness(install, [], { folds: () => (folds = new DurableFolds()) })
      return opened.harness
    })
  await opened.harness.settle()
  const native = opened.native()
  const conversations = await native.commit((tx) => pages((cursor) => tx.scanConversations({}, 256, cursor)), context)
  const root = conversations.find((conversation) => !conversation.owner)!
  const child = conversations.find((conversation) => conversation.owner)!
  const lineages = await native.commit(
    async (tx) =>
      (await folds.advance(tx, root.id)).newestTasks.size + (await folds.advance(tx, child.id)).newestTasks.size,
    context
  )
  const counts: ReadCounts = { entries: 0, tasks: 0, taskReads: 0, submissions: 0 }
  const reset = () => Object.assign(counts, { entries: 0, tasks: 0, taskReads: 0, submissions: 0 })
  const read = () => native.commit((tx) => readFacts(countingTx(tx, counts), folds, root.id), context)

  const facts = await read()
  reset()
  expect(await read()).toEqual(facts)
  expect(counts).toEqual({ entries: 0, tasks: expect.any(Number), taskReads: 0, submissions: 0 })
  expect(counts.tasks).toBeLessThanOrEqual(lineages)

  await native.commit(
    (tx) => tx.appendEntry(root.id, { kind: 'proof', model: [{ role: 'user', content: 'later', timestamp: 1 }] }),
    context
  )
  reset()
  await read()
  expect(counts.entries).toBe(1)

  const commit = native.commit.bind(native)
  native.commit = (call, callContext) => commit((tx) => call(countingTx(tx, counts)), callContext)
  reset()
  const answer = await opened.behavior().withCall(threadId(root.id), async (ports) => {
    const value = await ports.helpers.awaitAnswer(threadId(child.id), 1, 'fold-answer' as Key)
    await ports.helpers.stop(threadId(child.id), 1)
    return value
  })
  expect(answer?.outcome).toBe('completed')
  expect(counts.entries).toBe(0)
})
