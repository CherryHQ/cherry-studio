import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
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
  let captured: ConversationFacts['history'] = []
  const h = await openDurableHarness((ports) => {
    ports.lifecycle.register({
      onOpen: async () => {},
      onClose: async () => {},
      onCompacted: async () => {},
      async onCompacting(_thread, request) {
        captured = request.history
        return {
          summary: 'Earlier work',
          accounting: {
            key: `summary:${request.key}`,
            record: { type: 'summary-usage', value: { goalId: null, usage } }
          }
        }
      }
    })
  })
  const thread = await h.harness.createThread()
  h.harness.script(thread, [{ text: 'Earlier answer '.repeat(100) }, { text: 'Current answer' }])
  await h.harness.sendUser(thread, 'Earlier request '.repeat(100))
  await h.harness.settle()
  await h.harness.sendUser(thread, 'Current request')
  await h.harness.settle()
  await h.harness.compact(thread)
  await h.harness.settle()
  expect(captured.some((entry) => entry.kind === 'user' && entry.text.includes('Earlier request'))).toBe(true)
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

it('charges a child summary to its consuming run and retains the total after reopening', async () => {
  let reached!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    reached = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = await openDurableHarness(
    (ports) => {
      ports.lifecycle.register({
        onOpen: async () => {},
        onClose: async () => {},
        onCompacted: async () => {},
        onCompacting: async (_thread, request) => ({
          summary: 'Child context',
          accounting: {
            key: `summary:${request.key}`,
            record: { type: 'summary-usage', value: { goalId: null, usage } }
          }
        })
      })
    },
    [
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
    ]
  )
  const { parent, child } = await spawnChild(h.harness)
  const one = { ...usage, input: 0, output: 1, totalTokens: 1, costUsd: 0 }
  h.harness.script(child, [
    { text: 'Earlier answer '.repeat(100), usage: one },
    { text: '', toolCalls: [{ name: 'hold', args: {} }], usage: one },
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
      (ports) => {
        ports.lifecycle.register({
          onOpen: async () => {},
          onClose: async () => {},
          onCompacted: async () => {},
          async onCompacting(_thread, request) {
            summaryStarted.resolve()
            await summaryRelease.promise
            return {
              summary: 'Child context',
              accounting: {
                key: `summary:${request.key}`,
                record: { type: 'summary-usage', value: { goalId: null, usage } }
              }
            }
          }
        })
      },
      [
        defineExtension({
          name: 'hold-successor',
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
      { text: 'Initiating run answer', usage: { ...one, output: 2, totalTokens: 2 } },
      { text: '', toolCalls: [{ name: 'hold', args: {} }], usage: one },
      { text: 'Successor answer', usage: one }
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
        await send(3)
        await successorStarted.promise
      }
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
