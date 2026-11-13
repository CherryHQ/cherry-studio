import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { CompactionTask, defineExtension, defineTool, hook } from '@earendil-works/pi-durable'
import { obj } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import {
  encodeEntry,
  type Key,
  type ConversationFacts,
  type UsageFact,
  type ContractHarness
} from '@cherrystudio/agent-behavior'

import { conversationId, pages } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

const usage: UsageFact = { input: 11, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 17, costUsd: 0.002 }

it('persists summary accounting after task memos expire and reads it once after SQLite reopen', async () => {
  const h = await openDurableHarness(() => {})
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    { text: 'Earlier answer '.repeat(100) },
    { text: 'Current answer' },
    { text: 'Earlier work', usage }
  ])
  await h.harness.sendUser(thread, 'Earlier request '.repeat(100))
  await h.harness.settle()
  await h.harness.sendUser(thread, 'Current request')
  await h.harness.settle()
  await h.harness.compact(thread)
  await h.harness.settle()
  const facts = () => h.harness.withCall(thread, (ports) => ports.ledger.read(thread))
  const accounting = (history: ConversationFacts['history']) =>
    history.filter((entry) => entry.kind === 'record' && entry.record.type === 'summary-usage')
  expect(accounting((await facts()).history)).toMatchObject([{ record: { value: { goalId: null, usage } } }])
  const tasks = await h
    .native()
    .commit((tx) => pages((cursor) => tx.scanTasks({ conversationId: conversationId(thread) }, 256, cursor)), context)
  const summary = tasks.find((task) => task.kind === 'pi.compaction')
  expect(summary?.state.status).toBe('terminal')
  expect(summary).not.toHaveProperty('memos')
  await h.harness.restart()
  expect(accounting((await facts()).history)).toMatchObject([{ record: { value: { goalId: null, usage } } }])
  expect(accounting((await facts()).history)).toHaveLength(1)
  expect(h.errors).toEqual([])
})

it('keeps the goal that owned a compaction when the goal pauses before summarization', async () => {
  const started = gate()
  const release = gate()
  const h = await openDurableHarness(() => {}, [
    defineExtension({
      name: 'hold-summary-owner',
      hooks: [
        hook(CompactionTask, {
          async beforeCompact() {
            started.resolve()
            await release.promise
          }
        })
      ]
    })
  ])
  const thread = await h.harness.createThread()
  h.harness.script(thread, [{ text: 'Earlier answer' }, { text: 'Current answer' }, { text: 'Summary', usage }])
  await h.harness.sendUser(thread, 'Earlier request')
  await h.harness.settle()
  await h.harness.sendUser(thread, 'Current request')
  await h.harness.settle()
  const goal = {
    id: 'goal-1',
    revision: 1,
    objective: 'ship it',
    phase: 'active' as const,
    roundsStarted: 1,
    progressRounds: 0,
    maxGoalRounds: 20,
    tokensUsed: 0,
    costUsed: 0,
    wrapUpDone: false,
    armed: true,
    createdAt: 0,
    updatedAt: 0,
    admittedRound: 'round-1'
  }
  await h.harness.withCall(thread, (ports) =>
    ports.ledger.transact(thread, () => ({
      ops: [{ type: 'append-record', thread, record: { type: 'goal', value: goal }, key: 'goal-active' as Key }],
      effects: [],
      result: null
    }))
  )
  await h.harness.withCall(thread, (ports) =>
    ports.ledger.transact(thread, () => ({
      ops: [
        {
          type: 'append-quiet',
          thread,
          input: {
            ...encodeEntry({
              type: 'goal-round',
              round: { id: 'round-1', goalId: goal.id, revision: 1, round: 1, kind: 'work' }
            }),
            text: 'Work on the goal'
          },
          key: 'round-1' as Key
        }
      ],
      effects: [],
      result: null
    }))
  )
  const compacting = h.harness.compact(thread)
  await started.promise
  try {
    await h.harness.withCall(thread, (ports) =>
      ports.ledger.transact(thread, () => ({
        ops: [
          {
            type: 'append-record',
            thread,
            record: { type: 'goal', value: { ...goal, phase: 'paused', armed: false } },
            key: 'goal-paused' as Key
          }
        ],
        effects: [],
        result: null
      }))
    )
  } finally {
    release.resolve()
    await compacting
  }
  const facts = await h.harness.withCall(thread, (ports) => ports.ledger.read(thread))
  expect(
    facts.history.filter((entry) => entry.kind === 'record' && entry.record.type === 'summary-usage')
  ).toMatchObject([{ record: { value: { goalId: 'goal-1', goalRoundId: 'round-1', usage } } }])
})

it('charges a child summary to its consuming run and retains the total after reopening', async () => {
  let reached!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    reached = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = await openDurableHarness(() => {}, [
    defineExtension({
      name: 'hold',
      tools: [
        defineTool({
          name: 'hold',
          description: 'Hold',
          parameters: obj({}),
          replay: 'safe',
          async execute() {
            reached()
            await waiting
            return { output: [{ type: 'text', text: 'released' }] }
          }
        })
      ]
    })
  ])
  const { parent, child } = await spawnChild(h.harness)
  const one = { ...usage, input: 0, output: 1, totalTokens: 1, costUsd: 0 }
  h.harness.script(child, [
    { text: 'Earlier answer '.repeat(100), usage: one },
    { text: '', toolCalls: [{ name: 'hold', args: {} }], usage: one },
    { text: 'Child context', usage },
    { text: 'Done', usage: one }
  ])
  await h.harness.withCall(parent, (ports) =>
    ports.helpers.message(
      child,
      { ...encodeEntry({ type: 'subagent-message' }), data: {}, text: 'First request '.repeat(100) },
      'first' as Key,
      1
    )
  )
  await h.harness.settle()
  await h.harness.withCall(parent, (ports) =>
    ports.helpers.message(
      child,
      { ...encodeEntry({ type: 'subagent-message' }), data: {}, text: 'Second request' },
      'second' as Key,
      2
    )
  )
  await started
  try {
    await h.harness.compact(child)
  } finally {
    release()
  }
  await h.harness.settle()
  expect(
    (await h.harness.withCall(parent, (ports) => ports.ledger.read(parent))).children
      .get(child)
      ?.runUsage.map((value) => value.totalTokens)
  ).toEqual([1, 19])
  await h.harness.restart()
  expect(
    (await h.harness.withCall(parent, (ports) => ports.ledger.read(parent))).children
      .get(child)
      ?.runUsage.map((value) => value.totalTokens)
  ).toEqual([1, 19])
  expect(h.errors).toEqual([])
})

async function spawnChild(harness: ContractHarness) {
  const parent = await harness.createThread()
  const created = await harness.withCall(parent, (ports) =>
    ports.ledger.transact(parent, () => ({
      ops: [
        {
          type: 'spawn-child',
          key: 'spawn-summary-child' as Key,
          spec: {
            boundary: 'background',
            origin: {
              parentToolCallId: 'summary-child',
              fork: false,
              description: 'Child',
              modelKey: 'contract/model'
            },
            record: {
              parentToolCallId: 'summary-child',
              fork: false,
              description: 'Child',
              modelKey: 'contract/model',
              background: true,
              run: 1,
              status: 'running'
            }
          }
        }
      ],
      effects: [],
      result: null
    }))
  )
  const child = created.spawned[0].child
  return { parent, child }
}

it.each(['idle', 'successor'] as const)(
  'retains automatic background compaction usage on its initiating child run when placement sees %s',
  async (placement) => {
    const summaryStarted = gate()
    const summaryRelease = gate()
    const successorStarted = gate()
    const successorRelease = gate()
    const h = await openDurableHarness(
      () => {},
      [
        defineExtension({
          name: 'hold-successor',
          hooks: [
            hook(CompactionTask, {
              async beforeCompact() {
                summaryStarted.resolve()
                await summaryRelease.promise
              }
            })
          ],
          tools: [
            defineTool({
              name: 'hold',
              description: 'Hold the successor run',
              parameters: obj({}),
              replay: 'safe',
              async execute() {
                successorStarted.resolve()
                await successorRelease.promise
                return { output: [{ type: 'text', text: 'released' }] }
              }
            })
          ]
        })
      ],
      { settings: { retry: { enabled: false }, compaction: { keepRecentTokens: 1 } } }
    )
    const { parent, child } = await spawnChild(h.harness)
    const one = { ...usage, input: 0, output: 1, totalTokens: 1, costUsd: 0 }
    h.harness.script(child, [
      { text: 'Earlier answer', usage: { ...one, input: 89999, totalTokens: 90000 } },
      { text: 'Initiating run answer', usage: { ...one, output: 2, totalTokens: 2 } }
    ])
    const send = (run: number) =>
      h.harness.withCall(parent, (ports) =>
        ports.helpers.message(
          child,
          { ...encodeEntry({ type: 'subagent-message' }), data: {}, text: `Request ${run}` },
          `request-${run}` as Key,
          run
        )
      )
    try {
      await send(1)
      await h.harness.settle()
      await send(2)
      await summaryStarted.promise
      await (await h.native().conversation(conversationId(child), context))!.waitForIdle(context)
      if (placement === 'successor') {
        h.harness.script(child, [{ text: '', toolCalls: [{ name: 'hold', args: {} }], usage: one }])
        await send(3)
        await successorStarted.promise
      }
      h.harness.script(child, [
        { text: 'Child context', usage },
        { text: 'Successor answer', usage: one }
      ])
      summaryRelease.resolve()
      const tasks = await h
        .native()
        .commit(
          (tx) => pages((cursor) => tx.scanTasks({ conversationId: conversationId(child) }, 256, cursor)),
          context
        )
      const compaction = tasks.find((task) => task.kind === 'pi.compaction')!
      expect(compaction.background).toBe(true)
      await h.native().waitForTask(compaction.id, context)
    } finally {
      summaryRelease.resolve()
      successorRelease.resolve()
    }
    await h.harness.settle()
    const totals = async () =>
      (await h.harness.withCall(parent, (ports) => ports.ledger.read(parent))).children
        .get(child)
        ?.runUsage.map((value) => value.totalTokens)
    const expected = placement === 'idle' ? [90000, 19] : [90000, 19, 2]
    expect(await totals()).toEqual(expected)
    await h.harness.restart()
    expect(await totals()).toEqual(expected)
    expect(h.errors).toEqual([])
  }
)

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
