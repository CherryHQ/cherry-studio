import { join } from 'node:path'

import { defineTool, SessionManager } from '@earendil-works/pi-coding-agent'
import { obj } from '@earendil-works/pi-schema'
import { expect, it, onTestFinished } from 'vitest'

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'

import { createPiRuntime, type PiSessionOptions, type PiObservation } from '../src'
import { assistantReply, createTestBinding, MODEL, respondingModel, tempDir, type TestStream } from './sessionSupport'
import { gate, subagentCall, toolCallPart } from './subagentSupport'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

const draft = (text: string, whenBusy: 'reject' | 'steer' | 'follow-up' = 'reject') => ({
  inputId: runtimeId<'input'>(text),
  text,
  whenBusy
})

async function observe(handle: ThreadHandle) {
  const events: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  return events
}

const inputs = (events: ObservationPayload[], id: string) =>
  events.flatMap((event) => (event.type === 'input.changed' && event.input.inputId === id ? [event.input] : []))

async function setup(stream: TestStream, options: Partial<PiSessionOptions> = {}) {
  const cwd = tempDir('behavior-runtime')
  const errors: unknown[] = []
  const host = createScriptedHost({
    settings: {
      goalDefaults: { maxGoalRounds: 3, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
      autonomy: 'auto',
      permissionMode: 'auto',
      attendance: 'stream',
      maxBackground: 4,
      offloadThreshold: 20_000
    },
    modelKeys: { parentModelKey: 'test/test-model', defaultChildModelKey: 'test/test-model' }
  })
  const config: PiSessionOptions = {
    ...(await createTestBinding({ stream, model: MODEL })),
    cwd,
    agentDir: cwd,
    sessionManager: SessionManager.inMemory(cwd),
    compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1 },
    behavior: { host, configureChild: () => ({}) },
    ...options
  }
  const runtime = confirmed(
    await createPiRuntime({
      backendId: runtimeId('pi'),
      load: async (ref) => (ref.id === config.sessionManager?.getSessionId() ? config : undefined),
      onError: (error) => {
        errors.push(error)
      }
    })
  )
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  return { runtime, config, host, errors }
}

// Catches bypassing the adapter for native inputs, and losing correlation through native preflight and queues.
it('preserves command preflight, busy admission and input settlement with behavior installed', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  const provider = respondingModel((_call, n) =>
    n === 1 ? held.wait(assistantReply('first')) : assistantReply('second')
  )
  const { runtime, config, errors } = await setup(provider.model, {
    extensionFactories: [
      (pi) => {
        pi.registerCommand('local', { handler: async () => {} })
        pi.on('input', (event) => (event.text === 'handled' ? { action: 'handled' } : undefined))
      }
    ]
  })
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  expect(await root.input.submit(draft('start'))).toMatchObject({ status: 'acknowledged', facts: ['dispatch-started'] })
  await held.reached
  for (const text of ['/local', 'handled'])
    expect(await root.input.submit(draft(text))).toMatchObject({ status: 'acknowledged', facts: ['locally-handled'] })
  expect(await root.input.submit(draft('busy'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(await root.input.submit(draft('follow', 'follow-up'))).toMatchObject({
    status: 'acknowledged',
    facts: ['queued']
  })
  held.open()
  await expect
    .poll(() => inputs(events, 'follow').at(-1))
    .toMatchObject({ facts: ['queued', 'placed'], outcome: 'completed' })
  expect(provider.calls).toHaveLength(2)
  expect(
    provider.calls[1].messages.some(
      (message) => message.role === 'user' && JSON.stringify(message.content).includes('follow')
    )
  ).toBe(true)
  expect(inputs(events, 'busy')).toEqual([])
  expect(
    errors.filter((error) => !(error instanceof Error && error.message.startsWith('Agent is already processing')))
  ).toEqual([])
})

// Catches a stop during input hooks being forgotten when native Pi begins the run after those hooks finish.
it('cancels an input stopped during preflight before its first model request', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  const provider = respondingModel(() => assistantReply('must not be requested'))
  const { runtime, config, errors } = await setup(provider.model, {
    extensionFactories: [
      (pi) => {
        pi.on('input', async () => held.wait(undefined))
      }
    ]
  })
  const root = confirmed(await runtime.create(config))
  const pending = root.input.submit(draft('pending'))
  await held.reached
  confirmed(await root.interrupt!())
  held.open()
  await pending
  confirmed(await runtime.shutdown())
  expect(provider.calls).toHaveLength(0)
  expect(errors).toEqual([])
})

// Catches matching a stop only to the run's first input after native steering placed a later user turn.
it('stops the run containing a placed steering input', async () => {
  const first = gate()
  const second = gate()
  onTestFinished(() => {
    first.open()
    second.open()
  })
  const provider = respondingModel((_call, n) =>
    n === 1 ? first.wait(assistantReply('first')) : second.wait(assistantReply('never'))
  )
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('start'))
  await first.reached
  await root.input.submit(draft('steer', 'steer'))
  first.open()
  await second.reached
  confirmed(await root.interrupt!())
  await expect.poll(() => inputs(events, 'steer').at(-1)?.outcome).toBe('aborted')
})

// A child result must not release its reply before the notification's own model generation has settled.
it('keeps each native background result owned until its parent notification has finished', async () => {
  const childGates = [gate(), gate()]
  const summaryGates = [gate(), gate()]
  onTestFinished(() => {
    for (const held of [...childGates, ...summaryGates]) held.open()
  })
  let rootId = ''
  let childId = ''
  let children = 0
  let summaries = 0
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return childGates[children++].wait(assistantReply('child result'))
    const last = JSON.stringify(call.messages.at(-1))
    if (last.includes('delegate'))
      return assistantReply(
        [subagentCall('spawn', { description: 'scan', prompt: 'task', background: true })],
        'toolUse'
      )
    if (last.includes('continue-child'))
      return assistantReply(
        [toolCallPart('continue', 'message_subagent', { id: childId, message: 'next task' })],
        'toolUse'
      )
    if (last.includes('Background subagent update'))
      return summaryGates[summaries++].wait(assistantReply('parent summary'))
    return assistantReply('Parent waiting')
  })
  const { runtime, config, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const batches: PiObservation[] = []
  confirmed(
    await root.pi.observe((batch) => {
      batches.push(batch)
    })
  )
  const pending = () => batches.at(-1)?.backgroundResults
  for (const [index, call] of ['spawn', 'continue'].entries()) {
    await root.input.submit(draft(index === 0 ? 'delegate' : 'continue-child'))
    await childGates[index].reached
    await expect.poll(pending).toMatchObject({ status: 'confirmed', value: { pending: [call] } })
    await expect.poll(() => batches.filter((batch) => batch.settled).length).toBe(index * 2 + 1)
    const relation = batches.flatMap((batch) => batch.events).find((event) => event.type === 'subagent.upsert')
    if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('Missing child')
    childId = relation.subagent.child.id
    const beforeNotification = batches.length
    childGates[index].open()
    await summaryGates[index].reached
    await expect.poll(pending).toMatchObject({ status: 'confirmed', value: { pending: [call], notification: [call] } })
    expect(
      batches
        .slice(beforeNotification)
        .every(
          (batch) =>
            batch.backgroundResults?.status === 'confirmed' && batch.backgroundResults.value.pending.includes(call)
        )
    ).toBe(true)
    summaryGates[index].open()
    await expect.poll(pending).toMatchObject({ status: 'confirmed', value: { active: false, pending: [] } })
    expect(
      batches.filter((batch) => batch.backgroundResults && batch.backgroundResults.status !== 'confirmed')
    ).toEqual([])
  }
  expect(errors).toEqual([])
})

// Catches losing a public child's input identity while the report job or native steering queue delivers it.
it('correlates a steer placed in an already running child', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  let rootId = ''
  let childCalls = 0
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) {
      childCalls += 1
      return childCalls === 1 ? held.wait(assistantReply('child step')) : assistantReply('steered answer')
    }
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply(
        [subagentCall('spawn', { description: 'scan', prompt: 'task', background: true })],
        'toolUse'
      )
    return assistantReply('parent result')
  })
  const { runtime, config, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const parentEvents = await observe(root)
  await root.input.submit(draft('delegate'))
  await held.reached
  const relation = parentEvents.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child')
  const child = confirmed(await runtime.open(relation.subagent.child))
  const events = await observe(child)
  const initial = events[0]
  if (initial?.type !== 'snapshot') throw new Error('No child snapshot')
  const task = initial.messages.find((message) => message.role === 'user')
  expect(task?.parts).toEqual([{ type: 'text', text: expect.stringContaining('task'), state: 'done' }])
  expect(child.pi.archive().messages.find((message) => message.id === task?.id)).toEqual(task)
  const submitted = child.input.submit(draft('steer child', 'steer'))
  await expect
    .poll(() =>
      root.pi.history().some((entry) => entry.type === 'custom' && entry.customType === 'cherry.subagent-steer')
    )
    .toBe(true)
  held.open()
  expect(await submitted).toMatchObject({ status: 'acknowledged', facts: ['queued'] })
  await expect
    .poll(() => inputs(events, 'steer child').at(-1))
    .toMatchObject({
      facts: expect.arrayContaining(['queued', 'placed']),
      outcome: 'completed'
    })
  const archive = child.pi.archive().messages
  const placed = archive.find(
    (message) =>
      message.role === 'user' && message.parts.some((part) => part.type === 'text' && part.text === 'steer child')
  )
  expect(placed?.metadata?.inputId).toBe('steer child')
  expect(archive.findIndex((message) => message.id === placed?.id)).toBeLessThan(
    archive.findIndex((message) => message.parts.some((part) => part.type === 'text' && part.text === 'steered answer'))
  )
  expect(errors).toEqual([])
})

// Catches allocating a new child on continuation, losing its inputId, or retaining foreground cancellation ownership.
it('continues the discovered child in place, streams to shared handles and delivers its next run once', async () => {
  const childFinish = gate()
  const parentFinish = gate()
  onTestFinished(() => {
    childFinish.open()
    parentFinish.open()
  })
  let rootId = ''
  const childRequests: string[] = []
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) {
      childRequests.push(JSON.stringify(call.messages))
      return childRequests.length === 1
        ? assistantReply('first child result')
        : childFinish.wait(assistantReply('continued child result'))
    }
    const text = JSON.stringify(call.messages.at(-1))
    if (text.includes('delegate'))
      return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'first task' })], 'toolUse')
    if (text.includes('parent waits')) return parentFinish.wait(assistantReply('must be stopped'))
    return assistantReply('parent done')
  }, 1)
  const { runtime, config, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const rootEvents = await observe(root)
  await root.input.submit(draft('delegate'))
  await expect.poll(() => inputs(rootEvents, 'delegate').at(-1)?.outcome).toBe('completed')
  const relation = rootEvents.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child was published')
  expect(relation.subagent.origin).toEqual({ toolCallId: 'spawn', description: 'scan' })
  const child = confirmed(await runtime.open(relation.subagent.child))
  const second = confirmed(await runtime.open(child.thread))
  const childEvents = await observe(child)
  const secondEvents = await observe(second)
  expect(await child.input.submit(draft('continue child', 'steer'))).toMatchObject({
    status: 'acknowledged',
    facts: ['dispatch-started']
  })
  await childFinish.reached
  await root.input.submit(draft('parent waits'))
  await parentFinish.reached
  confirmed(await root.interrupt!())
  await child.release()
  const count = childEvents.length
  childFinish.open()
  await expect.poll(() => inputs(secondEvents, 'continue child').at(-1)?.outcome).toBe('completed')
  expect(childEvents).toHaveLength(count)
  expect(childRequests[1]).toContain('first child result')
  expect(childRequests[1]).toContain('continue child')
  expect(
    secondEvents.some((event) => event.type === 'message.upsert' && event.message.metadata?.completeness === 'partial')
  ).toBe(true)
  await expect
    .poll(
      () =>
        root.pi
          .history()
          .filter((entry) => entry.type === 'custom_message' && entry.customType === 'cherry.subagent-notification')
          .length
    )
    .toBe(1)
  expect(rootEvents.filter((event) => event.type === 'subagent.upsert')).toHaveLength(1)
  expect(relation.subagent.origin?.toolCallId).toBe('spawn')
  expect(child.thread).toEqual(second.thread)
  expect(inputs(rootEvents, 'parent waits').at(-1)?.outcome).toBe('aborted')
  expect(errors).toEqual([])
})

// Catches stopping only the child of a foreground tool and leaving its parent running, or cancelling a later turn.
it.each([false, true])('opens an admitted child after configuration settles (failed=%s)', async (failed) => {
  const configuring = gate()
  onTestFinished(() => configuring.open())
  let rootId = ''
  const provider = respondingModel((call) =>
    call.sessionId === rootId && JSON.stringify(call.messages.at(-1)).includes('delegate')
      ? assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'task' })], 'toolUse')
      : assistantReply('answer')
  )
  const { runtime, config, host } = await setup(provider.model)
  config.behavior = {
    host,
    configureChild: async () => {
      await configuring.wait(undefined)
      if (failed) throw new Error('child configuration failed')
      return {}
    }
  }
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  expect(await root.pi.openChild('unknown')).toMatchObject({ status: 'rejected', error: { code: 'unknown-call' } })
  await root.input.submit(draft('delegate'))
  await configuring.reached
  const pending = root.pi.openChild('spawn')
  const concurrent = root.pi.openChild('spawn')
  const temporary = confirmed(await runtime.open(root.thread))
  const cancelled = temporary.pi.openChild('spawn')
  await temporary.release()
  expect(await cancelled).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  configuring.open()
  if (failed) {
    for (const result of await Promise.all([pending, concurrent]))
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'child-unavailable' } })
  } else {
    const first = confirmed(await pending)
    const second = confirmed(await concurrent)
    expect(first.relation).toEqual(second.relation)
    expect(first.relation.origin).toEqual({ toolCallId: 'spawn', description: 'scan' })
    expect(first.handle).not.toBe(second.handle)
    await first.handle.release()
    await root.pi.settled()
    expect(
      second.handle.pi
        .archive()
        .messages.some((message) => message.parts.some((part) => part.type === 'text' && part.text === 'answer'))
    ).toBe(true)
    expect(provider.calls.filter((call) => call.sessionId !== rootId)).toHaveLength(1)
  }
})

// Catches configuration waits keeping an access alive after its owner has begun shutdown.
it('settles child access waits before shutdown joins blocked configuration', async () => {
  const configuring = gate()
  onTestFinished(() => configuring.open())
  const provider = respondingModel(() =>
    assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'task' })], 'toolUse')
  )
  const { runtime, config, host } = await setup(provider.model)
  config.behavior = { host, configureChild: () => configuring.wait({}) }
  const root = confirmed(await runtime.create(config))
  await root.input.submit(draft('delegate'))
  await configuring.reached
  const pending = root.pi.openChild('spawn')
  const closed = runtime.shutdown()
  expect(await pending).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  configuring.open()
  confirmed(await closed)
  expect(provider.calls).toHaveLength(1)
})

// Catches stopping only the child of a foreground tool and leaving its parent running, or cancelling a later turn.
it('routes a foreground child interrupt through behavior and leaves later parent turns alone', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  let rootId = ''
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return held.wait(assistantReply('never'))
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'task' })], 'toolUse')
    return assistantReply('new answer')
  })
  const { runtime, config, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const events = await observe(root)
  await root.input.submit(draft('delegate'))
  await held.reached
  const relation = events.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child')
  const child = confirmed(await runtime.open(relation.subagent.child))
  confirmed(await child.interrupt!())
  await expect.poll(() => inputs(events, 'delegate').at(-1)?.outcome).toBe('aborted')
  await root.input.submit(draft('next'))
  confirmed(await child.interrupt!())
  await expect.poll(() => inputs(events, 'next').at(-1)?.outcome).toBe('completed')
  expect(root.pi.history().some((entry) => entry.type === 'custom' && entry.customType === 'cherry.turn-stop')).toBe(
    true
  )
  expect(errors).toEqual([])
})

// Catches passing /goal to the model and omitting the permission-change entry that wakes a plan-held goal.
it('handles goal commands locally and runs the goal only after permission changes', async () => {
  const provider = respondingModel(() => assistantReply('goal response'))
  const { runtime, config, host } = await setup(provider.model)
  host.setSettings({
    permissionMode: 'plan',
    goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 }
  })
  const root = confirmed(await runtime.create(config))
  expect(await root.input.submit(draft('/goal test goal'))).toMatchObject({ facts: ['locally-handled'] })
  expect(provider.calls).toHaveLength(0)
  expect(host.emitted.some((event) => event.type === 'goal-notice' && event.notice.text === 'Goal created.')).toBe(true)
  host.setSettings({ permissionMode: 'auto' })
  confirmed(await root.pi.permissionModeChanged())
  await expect.poll(() => provider.calls.length).toBe(1)
  confirmed(await root.interrupt!())
})

// Catches lost manual instructions, native history or session identity on reopen.
it('uses native manual compaction and preserves identity on reopen', async () => {
  const provider = respondingModel((_call, n) => assistantReply(n === 1 ? 'answer' : 'native summary'))
  const { runtime, config, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('question'))
  await expect.poll(() => inputs(events, 'question').at(-1)?.outcome).toBe('completed')
  confirmed(await root.pi.compact('keep paths'))
  expect(JSON.stringify(provider.calls[1].messages)).toContain('keep paths')
  expect(
    root.pi.history().some((entry) => entry.type === 'compaction' && entry.summary.includes('native summary'))
  ).toBe(true)
  expect(provider.calls).toHaveLength(2)
  confirmed(await runtime.shutdown())
  const reopened = confirmed(await createPiRuntime({ backendId: root.thread.backendId, load: async () => config }))
  onTestFinished(async () => {
    await reopened.shutdown()
  })
  const handle = confirmed(await reopened.open(root.thread))
  expect(handle.thread).toEqual(root.thread)
  expect(handle.pi.history().some((entry) => entry.type === 'compaction')).toBe(true)
  expect(provider.calls).toHaveLength(2)
  expect(errors).toEqual([])
})

// Catches manual compaction surviving Stop or blocking shutdown before native cancellation.
it.each(['interrupt', 'shutdown'] as const)('cancels a standalone manual compaction on %s', async (action) => {
  let started!: (signal: AbortSignal) => void
  const summaryStarted = new Promise<AbortSignal>((resolve) => {
    started = resolve
  })
  const summary = gate()
  const provider = respondingModel((call, n) => {
    if (n === 1) return assistantReply('answer')
    started(call.signal!)
    return summary.wait(assistantReply('summary'))
  })
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('question'))
  await expect.poll(() => inputs(events, 'question').at(-1)?.outcome).toBe('completed')
  const compacting = root.pi.compact()
  const signal = await summaryStarted
  try {
    const stopping = action === 'interrupt' ? root.interrupt!() : runtime.shutdown()
    await expect.poll(() => signal.aborted).toBe(true)
    expect(await stopping).toMatchObject({ status: 'confirmed', value: undefined })
    expect((await compacting).status).not.toBe('confirmed')
    expect(root.pi.history().some((entry) => entry.type === 'compaction')).toBe(false)
  } finally {
    summary.open()
    await compacting
  }
})

// Catches a failed native summary being reported as a successful compaction.
it('rejects an empty native summary without changing the compacted history', async () => {
  const provider = respondingModel((_call, n) => assistantReply(n === 1 ? 'answer' : ' '))
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('question'))
  await expect.poll(() => inputs(events, 'question').at(-1)?.outcome).toBe('completed')
  expect((await root.pi.compact()).status).not.toBe('confirmed')
  expect(root.pi.history().some((entry) => entry.type === 'compaction')).toBe(false)
  expect(provider.calls).toHaveLength(2)
})

// Catches a missing tool gate (the denied write runs) or a question result never reaching the native model context.
it('uses host approvals and question answers through the shared behavior tools', async () => {
  const writes: string[] = []
  const provider = respondingModel((_call, n) =>
    n === 1
      ? assistantReply([toolCallPart('write', 'change_file', {})], 'toolUse')
      : n === 2
        ? assistantReply(
            [
              toolCallPart('ask', 'AskUserQuestion', {
                questions: [
                  {
                    question: 'Which database?',
                    header: 'Database',
                    options: [
                      { label: 'Postgres', description: 'Relational' },
                      { label: 'Redis', description: 'In memory' }
                    ]
                  }
                ]
              })
            ],
            'toolUse'
          )
        : assistantReply('use Redis')
  )
  const { runtime, config, host, errors } = await setup(provider.model, {
    tools: [
      defineTool({
        name: 'change_file',
        label: 'Change file',
        description: 'Change a file',
        parameters: obj({}),
        execute: async () => {
          writes.push('changed')
          return { content: [{ type: 'text', text: 'changed' }], details: {} }
        }
      })
    ]
  })
  host.answerApproval({ kind: 'denied', feedback: 'Leave the file alone' })
  host.answerQuestion({ status: 'answered', answers: { 'Which database?': 'Redis' } })
  const root = confirmed(
    await runtime.create({
      ...config,
      behavior: {
        ...config.behavior,
        host: {
          ...host,
          approvals: {
            ...host.approvals,
            facts: async (call, tool) => ({
              ...(await host.approvals.facts(call, tool)),
              approvalRequired: tool.name === 'change_file'
            })
          }
        }
      }
    })
  )
  const events = await observe(root)
  await root.input.submit(draft('help choose'))
  await expect.poll(() => inputs(events, 'help choose').at(-1)?.outcome).toBe('completed')
  expect(writes).toEqual([])
  expect(JSON.stringify(provider.calls[1].messages)).toContain('Leave the file alone')
  expect(JSON.stringify(provider.calls[2].messages)).toContain('Redis')
  expect(errors).toEqual([])
})

// Catches a pending question surviving Stop, or its late answer causing an unrequested model turn.
it('cancels a native question and ignores its late answer', async () => {
  const provider = respondingModel(() =>
    assistantReply(
      [
        toolCallPart('ask', 'AskUserQuestion', {
          questions: [
            {
              question: 'Which database?',
              header: 'Database',
              options: [
                { label: 'Postgres', description: 'Relational' },
                { label: 'Redis', description: 'In memory' }
              ]
            }
          ]
        })
      ],
      'toolUse'
    )
  )
  const { runtime, config, host, errors } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('help choose'))
  await expect.poll(() => host.asked.questions).toBe(1)
  confirmed(await root.interrupt!())
  await root.pi.settled()
  await expect.poll(() => inputs(events, 'help choose').at(-1)?.outcome).toBe('aborted')
  const result = () =>
    root.pi.history().find((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
  expect(result()).toMatchObject({ message: { details: { outcome: 'aborted' } } })
  host.answerQuestion({ status: 'answered', answers: { 'Which database?': 'Redis' } })
  await root.pi.settled()
  expect(result()).toMatchObject({ message: { details: { outcome: 'aborted' } } })
  expect(provider.calls).toHaveLength(1)
  expect(errors).toEqual([])
})

// Catches a Todo result kept only in extension memory, or a reopen that starts work to recover it.
it('restores Todo output from its native file without submitting input', async () => {
  const todos = [{ content: 'Keep the saved task', status: 'in_progress' }]
  const provider = respondingModel((_call, n) =>
    n === 1
      ? assistantReply([toolCallPart('todo', 'todo_write', { todos })], 'toolUse')
      : assistantReply('task recorded')
  )
  const { runtime, config, errors } = await setup(provider.model)
  const manager = SessionManager.create(config.cwd, join(config.cwd, 'sessions'))
  const root = confirmed(await runtime.create({ ...config, sessionManager: manager }))
  await root.input.submit(draft('record the task'))
  await root.pi.settled()
  confirmed(await runtime.shutdown())
  const reopened = confirmed(
    await createPiRuntime({
      backendId: root.thread.backendId,
      load: async () => ({
        ...config,
        sessionManager: SessionManager.openExisting(manager.getSessionFile()!, root.thread.id)
      })
    })
  )
  onTestFinished(async () => {
    await reopened.shutdown()
  })
  const handle = confirmed(await reopened.open(root.thread))
  expect(
    handle.pi.history().find((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
  ).toMatchObject({
    message: { toolName: 'todo_write', details: { todos, counts: { pending: 0, inProgress: 1, completed: 0 } } }
  })
  expect(JSON.stringify(handle.pi.archive().messages)).toContain('Keep the saved task')
  expect(provider.calls).toHaveLength(2)
  expect(errors).toEqual([])
})

// Catches waiting for child admission before withdrawing its steer, which deadlocks shutdown on the child's run.
it('withdraws a pending child input and closes the native graph on shutdown', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  let rootId = ''
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return held.wait(assistantReply('never'))
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply(
        [subagentCall('spawn', { description: 'scan', prompt: 'task', background: true })],
        'toolUse'
      )
    return assistantReply('parent done')
  })
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const events = await observe(root)
  await root.input.submit(draft('delegate'))
  await held.reached
  const relation = events.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child')
  const child = confirmed(await runtime.open(relation.subagent.child))
  const childEvents = await observe(child)
  const submitted = child.input.submit(draft('pending child steer', 'steer'))
  await expect
    .poll(() =>
      root.pi.history().some((entry) => entry.type === 'custom' && entry.customType === 'cherry.subagent-steer')
    )
    .toBe(true)
  expect(await runtime.shutdown()).toMatchObject({ status: 'confirmed', value: undefined })
  expect(await submitted).toMatchObject({ status: 'rejected' })
  await expect.poll(() => childEvents.at(-1)).toMatchObject({ type: 'closed', reason: 'shutdown' })
  expect(await child.input.submit(draft('too late', 'steer'))).toMatchObject({
    status: 'rejected',
    error: { code: 'closed' }
  })
})

// Catches silently loading a persisted child as an independent root, losing its behavior ownership.
it('restores child relations on reopen and refuses a child without its live owner', async () => {
  let rootId = ''
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return assistantReply('child done')
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'task' })], 'toolUse')
    return assistantReply('parent done')
  })
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  rootId = root.thread.id
  const events = await observe(root)
  await root.input.submit(draft('delegate'))
  await expect.poll(() => inputs(events, 'delegate').at(-1)?.outcome).toBe('completed')
  const relation = events.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child')
  const childAccess = confirmed(await runtime.open(relation.subagent.child))
  const childManager = SessionManager.inMemory(config.cwd, { id: childAccess.thread.id }, [...childAccess.pi.history()])
  confirmed(await runtime.shutdown())
  const reopened = confirmed(
    await createPiRuntime({
      backendId: root.thread.backendId,
      load: async (ref) => ({
        ...config,
        sessionManager: ref.id === rootId ? config.sessionManager : childManager
      })
    })
  )
  onTestFinished(async () => {
    await reopened.shutdown()
  })
  const rootAgain = confirmed(await reopened.open(root.thread))
  const restored = await observe(rootAgain)
  await expect.poll(() => restored[0]).toMatchObject({ type: 'snapshot', subagents: [relation.subagent] })
  expect(await reopened.open(relation.subagent.child)).toMatchObject({
    status: 'rejected',
    error: { code: 'child-owner-unavailable' }
  })
})

// Catches an unavailable historical child model preventing the healthy parent and siblings from reopening.
it('isolates child restore failures and recovers the same child after its model is available again', async () => {
  const cwd = tempDir('behavior-child-restore')
  const manager = SessionManager.create(cwd, join(cwd, 'sessions'))
  const rootId = manager.getSessionId()
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return assistantReply('child answer')
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply(
        [
          toolCallPart('missing-model', 'subagent', {
            description: 'Unavailable',
            prompt: 'first task',
            model: 'Alternate'
          }),
          subagentCall('healthy', { description: 'Healthy', prompt: 'second task' })
        ],
        'toolUse'
      )
    return assistantReply('parent answer')
  })
  const alternate = await createTestBinding({ stream: provider.model, model: { ...MODEL, id: 'alternate' } })
  const { runtime, config, host } = await setup(provider.model, { cwd, agentDir: cwd, sessionManager: manager })
  const childIds = new Map<string, string>()
  let unavailable = false
  config.behavior = {
    host: {
      ...host,
      models: {
        ...host.models,
        find: async () => [{ key: 'test/alternate', provider: 'test', model: 'Alternate', exact: true }]
      }
    },
    configureChild: ({ thread, modelKey }) => {
      if (modelKey === 'test/alternate' && unavailable) throw new Error('Unknown subagent model: test/alternate')
      childIds.set(modelKey, thread.id)
      return modelKey === 'test/alternate' ? alternate : {}
    }
  }
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('delegate'))
  await expect.poll(() => inputs(events, 'delegate').at(-1)?.outcome).toBe('completed')
  expect(childIds.size).toBe(2)
  const childRef = { backendId: root.thread.backendId, id: runtimeId<'thread'>(childIds.get('test/alternate')!) }
  const child = confirmed(await runtime.open(childRef))
  const archive = child.pi.archive()
  const runs = () =>
    manager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'cherry.subagent-run')
  const completedRuns = structuredClone(runs())
  confirmed(await runtime.shutdown())
  unavailable = true
  const errors: unknown[] = []
  const reopen = async () => {
    const reopened = confirmed(
      await createPiRuntime({
        backendId: root.thread.backendId,
        load: async (ref) => {
          const saved = (await SessionManager.list(cwd, join(cwd, 'sessions'))).find((saved) => saved.id === ref.id)
          return saved ? { ...config, sessionManager: SessionManager.openExisting(saved.path, ref.id) } : undefined
        },
        onError: (error) => {
          errors.push(error)
        }
      })
    )
    onTestFinished(async () => {
      await reopened.shutdown()
    })
    return reopened
  }
  const reopened = await reopen()
  const beforeRestore = provider.calls.length
  const rootAgain = confirmed(await reopened.open(root.thread))
  const restored = await observe(rootAgain)
  expect(provider.calls).toHaveLength(beforeRestore)
  expect(restored[0]).toMatchObject({
    type: 'snapshot',
    subagents: expect.arrayContaining([expect.objectContaining({ child: childRef })])
  })
  expect(await reopened.open(childRef)).toMatchObject({
    status: 'rejected',
    error: { code: 'child-owner-unavailable' }
  })
  const healthy = confirmed(await reopened.open({ ...childRef, id: runtimeId(childIds.get('test/test-model')!) }))
  expect(JSON.stringify(healthy.pi.archive().messages)).toContain('child answer')
  expect(
    rootAgain.pi.history().filter((entry) => entry.type === 'custom' && entry.customType === 'cherry.subagent-run')
  ).toEqual(completedRuns)
  await rootAgain.input.submit(draft('continue parent'))
  await expect.poll(() => inputs(restored, 'continue parent').at(-1)?.outcome).toBe('completed')
  expect(errors).toHaveLength(1)
  expect(errors[0]).toEqual(new Error('Unknown subagent model: test/alternate'))
  confirmed(await reopened.shutdown())

  unavailable = false
  const recovered = await reopen()
  confirmed(await recovered.open(root.thread))
  const sameChild = confirmed(await recovered.open(childRef))
  expect(sameChild.pi.archive().messages).toEqual(archive.messages)
  const continued = await observe(sameChild)
  expect(await sameChild.input.submit(draft('continue child', 'steer'))).toMatchObject({ status: 'acknowledged' })
  await expect.poll(() => inputs(continued, 'continue child').at(-1)?.outcome).toBe('completed')
})
