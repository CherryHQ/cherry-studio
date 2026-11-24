import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson, type JsonRepresentation } from '@earendil-works/chord/json'
import { createModels } from '@earendil-works/pi-ai'
import {
  GenerationTask,
  Harness,
  MemoryStorage,
  ToolTask,
  createRegistry,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type TaskId,
  type TaskRecord
} from '@earendil-works/pi-durable'
import { afterEach, expect, it, vi } from 'vitest'

import { callKeyOf, encodeEntry } from '@cherrystudio/agent-behavior'
import { runtimeId, type JsonValue } from '@cherrystudio/agent-runtime'

import { DurableFolds, HistoryFold, historyOf, readFacts } from '../src/behavior/history'
import { countingTx, type ReadCounts } from './behaviorHarness'

const encoded = (...args: Parameters<typeof encodeEntry>) =>
  copyJson(encodeEntry(...args)) as JsonRepresentation<ReturnType<typeof encodeEntry>>

const noReads = (): ReadCounts => ({ entries: 0, tasks: 0, taskReads: 0, submissions: 0 })

afterEach(() => {
  vi.useRealTimers()
})

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
    const facts = await native.commit((tx) => readFacts(tx, new DurableFolds(), fork.id), context)
    expect(facts.lineage).toEqual({ kind: 'root' })
    expect(facts.history.filter((entry) => entry.kind === 'user').map((entry) => entry.text)).toEqual([
      'Retained context'
    ])
    expect(facts.history.filter((entry) => entry.kind === 'record').map((entry) => entry.record)).toEqual([
      { type: 'turn-stop', value: { cause: 'user', at: 2 } }
    ])
    expect([...facts.keysSeen]).toEqual(['fork-stop'])
    const original = await native.commit((tx) => readFacts(tx, new DurableFolds(), parent.id), context)
    expect(original.history.filter((entry) => entry.kind === 'record')).toHaveLength(2)
  } finally {
    await native.close(context)
  }
})

// Catches a warm fold that rereads, drops or repeats entries, or lets media change the facts.
it('advances a warm fold by only newer entries and reads the same facts as an empty one', async () => {
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
    const folds = new DurableFolds()
    await native.commit((tx) => readFacts(tx, folds, conversation.id), context)
    await append(40, 2)
    await native.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: 'cherry.reference-context',
          model: [{ role: 'user', content: 'Reference only', timestamp: 0 }]
        }),
      context
    )

    const counts = noReads()
    const warm = await native.commit((tx) => readFacts(countingTx(tx, counts), folds, conversation.id), context)
    expect(counts.entries).toBe(3)
    expect(warm).toEqual(await native.commit((tx) => readFacts(tx, new DurableFolds(), conversation.id), context))
    expect(warm.history.flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []))).toEqual(texts(42))
    const repeated = noReads()
    await native.commit((tx) => readFacts(countingTx(tx, repeated), folds, conversation.id), context)
    expect(repeated.entries).toBe(0)

    const earlier = await native.commit((tx) => readFacts(tx, folds, conversation.id, new Set(), boundary.id), context)
    expect(earlier.history.flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []))).toEqual(texts(40))
  } finally {
    await native.close(context)
  }
})

// Catches a tool task folded after its assistant entry that leaves the call, or a result keyed through it, on the
// placeholder key a rebuild would not give, and a row folded twice.
it('keys calls and their results the same whichever order tasks and entries fold in', () => {
  const owner = 1 as ConversationId
  const entry = (id: number, model: NonNullable<EntryRecord['model']>, byTaskId?: number) =>
    ({ id: id as EntryId, conversationId: owner, kind: 'proof', data: {}, model, byTaskId }) as unknown as EntryRecord
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
  const entries = [
    entry(2, [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'a', name: 'read', arguments: {} },
          { type: 'toolCall', id: 'b', name: 'read', arguments: {} }
        ],
        api: 'faux',
        provider: 'faux',
        model: 'faux',
        usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse',
        timestamp: 2
      }
    ]),
    entry(4, [{ role: 'toolResult', toolCallId: 'a', toolName: 'read', content: [], isError: false, timestamp: 4 }], 3),
    // A result appended without a task resolves its key through the latest call with its ID.
    entry(6, [{ role: 'toolResult', toolCallId: 'b', toolName: 'read', content: [], isError: true, timestamp: 6 }])
  ]
  const task = (id: number, callId: string) =>
    ({
      id: id as TaskId,
      conversationId: owner,
      kind: ToolTask.definition.name,
      input: { kind: 'model', assistant: 2, callId }
    }) as unknown as TaskRecord<JsonValue, JsonValue, JsonValue>
  const tasks = [task(3, 'a'), task(5, 'b')]

  const late = new HistoryFold(owner)
  late.addTask(tasks[0])
  for (const value of entries) late.addEntry(value)
  late.addTask(tasks[1])
  const after = new HistoryFold(owner)
  for (const value of entries) after.addEntry(value)
  for (const value of tasks) after.addTask(value)

  const keys = (history: readonly ReturnType<typeof historyOf>[number][]) =>
    history.flatMap((item) =>
      item.kind === 'assistant'
        ? item.toolCalls.map((call) => call.callKey)
        : item.kind === 'tool-result'
          ? [item.callKey]
          : []
    )
  const expected = [callKeyOf('3'), callKeyOf('5'), callKeyOf('3'), callKeyOf('5')]
  expect(keys(historyOf(entries, tasks, owner))).toEqual(expected)
  expect(late.history).toEqual(historyOf(entries, tasks, owner))
  expect(after.history).toEqual(historyOf(entries, tasks, owner))

  // The runtime feeds one fold from its opening scan and from commit notifications, which can overlap.
  const repeated = new HistoryFold(owner)
  for (const value of [...entries, ...entries.slice(1)]) repeated.addEntry(value)
  for (const value of [...tasks, tasks[0]]) repeated.addTask(value)
  expect(repeated.history).toEqual(historyOf(entries, tasks, owner))
  const generation = (id: number) =>
    ({
      id: id as TaskId,
      conversationId: owner,
      kind: GenerationTask.definition.name,
      input: {},
      state: { status: 'running' }
    }) as unknown as TaskRecord<JsonValue, JsonValue, JsonValue>
  for (const value of [generation(7), generation(9), generation(7)]) repeated.addTask(value)
  expect(repeated.generation?.id).toBe(9)
})

// Catches a fold that is never released, or one rebuilt while still in use.
it('drops a fold unused for ten minutes and rebuilds equal facts', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const context = BACKGROUND_CONTEXT
  const native = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context
  )
  try {
    const conversation = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
    await native.commit(async (tx) => {
      for (let index = 0; index < 3; index++)
        await tx.appendEntry(conversation.id, {
          kind: 'proof',
          model: [{ role: 'user', content: `input-${index}`, timestamp: index }]
        })
    }, context)
    const folds = new DurableFolds()
    const read = async () => {
      const counts = noReads()
      const facts = await native.commit((tx) => readFacts(countingTx(tx, counts), folds, conversation.id), context)
      return { facts, entries: counts.entries }
    }
    const minute = 60_000
    vi.setSystemTime(0)
    const first = await read()
    expect(first.entries).toBe(3)
    vi.setSystemTime(9 * minute)
    expect(await read()).toEqual({ facts: first.facts, entries: 0 })
    vi.setSystemTime(19 * minute + 1)
    expect(await read()).toEqual({ facts: first.facts, entries: 3 })
  } finally {
    await native.close(context)
  }
})
