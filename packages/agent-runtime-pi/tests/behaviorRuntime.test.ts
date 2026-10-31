import { Type } from '@earendil-works/pi-ai'
import { defineTool, SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import { createScriptedHost, type HostPorts } from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'

import { createPiRuntime, type PiSessionOptions } from '../src'
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
  expect(confirmed(await root.interrupt!()).effect).toBe('requested')
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
      outcome: 'completed',
      response: { session: child.thread }
    })
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
  expect(child.thread).toEqual(second.thread)
  expect(inputs(rootEvents, 'parent waits').at(-1)?.outcome).toBe('aborted')
  expect(errors).toEqual([])
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

// Catches bypassing the shared summary acceptance or dropping a caller's compaction instructions.
it('routes manual compaction to the host and preserves the native identity on reopen', async () => {
  const provider = respondingModel(() => assistantReply('answer'))
  const { runtime, config, host, errors } = await setup(provider.model)
  const requests: Parameters<HostPorts['summarizer']['summarize']>[0][] = []
  const behavior = config.behavior!
  const root = confirmed(
    await runtime.create({
      ...config,
      behavior: {
        ...behavior,
        host: {
          ...host,
          summarizer: {
            summarize: async (request) => {
              requests.push(request)
              return 'summary from the shared behavior'
            }
          }
        }
      }
    })
  )
  const events = await observe(root)
  await root.input.submit(draft('question'))
  await expect.poll(() => inputs(events, 'question').at(-1)?.outcome).toBe('completed')
  confirmed(await root.pi.compact('keep paths'))
  expect(requests[0]).toMatchObject({ thread: root.thread.id, instructions: 'keep paths' })
  expect(
    root.pi
      .history()
      .some((entry) => entry.type === 'compaction' && entry.summary === 'summary from the shared behavior')
  ).toBe(true)
  expect(provider.calls).toHaveLength(1)
  confirmed(await runtime.shutdown())
  const reopened = confirmed(await createPiRuntime({ backendId: root.thread.backendId, load: async () => config }))
  onTestFinished(async () => {
    await reopened.shutdown()
  })
  const handle = confirmed(await reopened.open(root.thread))
  expect(handle.thread).toEqual(root.thread)
  expect(handle.pi.history().some((entry) => entry.type === 'compaction')).toBe(true)
  expect(provider.calls).toHaveLength(1)
  expect(errors).toEqual([])
})

// Catches reporting a declined compaction as successful, or falling back to the native model for its summary.
it('rejects an empty host summary without changing native history', async () => {
  const provider = respondingModel(() => assistantReply('answer'))
  const { runtime, config, host } = await setup(provider.model)
  const root = confirmed(await runtime.create(config))
  const events = await observe(root)
  await root.input.submit(draft('question'))
  await expect.poll(() => inputs(events, 'question').at(-1)?.outcome).toBe('completed')
  host.giveSummary(' ')
  expect(await root.pi.compact()).toMatchObject({ status: 'rejected', error: { code: 'declined' } })
  expect(root.pi.history().some((entry) => entry.type === 'compaction')).toBe(false)
  expect(provider.calls).toHaveLength(1)
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
        parameters: Type.Object({}),
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
        ...config.behavior!,
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
  expect(await runtime.shutdown()).toMatchObject({ status: 'confirmed', value: { effect: 'closed' } })
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
  let childManager: SessionManager | undefined
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return assistantReply('child done')
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'task' })], 'toolUse')
    return assistantReply('parent done')
  })
  const { runtime, config } = await setup(provider.model)
  const root = confirmed(
    await runtime.create({
      ...config,
      behavior: {
        ...config.behavior!,
        configureChild: () => ({
          onSessionCreated: (session) => {
            childManager = session.sessionManager
          }
        })
      }
    })
  )
  rootId = root.thread.id
  const events = await observe(root)
  await root.input.submit(draft('delegate'))
  await expect.poll(() => inputs(events, 'delegate').at(-1)?.outcome).toBe('completed')
  const relation = events.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('No child')
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
