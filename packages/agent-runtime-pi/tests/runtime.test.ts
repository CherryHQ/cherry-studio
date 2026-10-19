import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
  type FauxResponseStep
} from '@earendil-works/pi-ai'
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'

import { createPiRuntime, type AgentRuntimeEvent, type PiRuntimeOptions } from '../src'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

const input = (text: string, whenBusy: 'reject' | 'steer' | 'follow-up' = 'reject') => ({
  inputId: runtimeId<'input'>(text),
  text,
  whenBusy
})

async function setup(load?: PiRuntimeOptions['load']) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-adapter-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  const faux = fauxProvider({ tokensPerSecond: 80, tokenSize: { min: 1, max: 1 } })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerNativeProvider(faux.provider)
  const options = { cwd, agentDir: cwd, modelRuntime, model: modelRuntime.getModel('faux', 'faux-1')! }
  const runtime = confirmed(await createPiRuntime({ backendId: runtimeId('native-pi'), load }))
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  return { runtime, options, faux }
}

async function observe(handle: ThreadHandle) {
  const events: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  return events
}

it('shares streamed item identities across handles while releasing only one observation', async () => {
  const { runtime, options, faux } = await setup()
  faux.setResponses([fauxAssistantMessage('native output for both handles')])
  const first = confirmed(await runtime.create(options))
  const second = confirmed(await runtime.open(first.thread))
  const left = await observe(first)
  const right = await observe(second)
  expect(await first.input.submit(input('question'))).toMatchObject({
    status: 'acknowledged',
    facts: ['dispatch-started']
  })
  const messages = (events: ObservationPayload[]) =>
    events.filter(
      (event): event is Extract<ObservationPayload, { type: 'item.upsert' }> =>
        event.type === 'item.upsert' && event.item.type === 'message' && event.item.role === 'assistant'
    )
  await expect.poll(() => messages(right).length).toBeGreaterThan(0)
  expect(messages(left).map((event) => event.item.ref)).toEqual(messages(right).map((event) => event.item.ref))
  await first.release()
  const count = left.length
  await expect
    .poll(() => messages(right).at(-1)?.item)
    .toMatchObject({
      completeness: 'complete',
      parts: [{ type: 'text', text: 'native output for both handles' }]
    })
  expect(left).toHaveLength(count)
  expect(await first.input.submit(input('released'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
})

it('keeps native command preflight, rejects busy prompts and acknowledges queued follow-ups', async () => {
  const { runtime, options, faux } = await setup()
  let started!: () => void
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const block: FauxResponseStep = (_context, call) =>
    new Promise((_, reject) => {
      started()
      const signal = call!.signal!
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  faux.setResponses([block])
  const manager = SessionManager.inMemory(options.cwd)
  let commands = 0
  const handle = confirmed(
    await runtime.create({
      ...options,
      sessionManager: manager,
      extensionFactories: [
        (pi) => {
          pi.registerCommand('local', {
            handler: async () => {
              commands++
            }
          })
        }
      ]
    })
  )
  const events = await observe(handle)
  await handle.input.submit(input('start'))
  await reached
  expect(await handle.input.submit(input('/local'))).toMatchObject({
    status: 'acknowledged',
    facts: ['locally-handled']
  })
  expect(commands).toBe(1)
  expect(await handle.input.submit(input('rejected'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(manager.buildSessionContext().messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(await handle.input.submit(input('later', 'follow-up'))).toMatchObject({
    status: 'acknowledged',
    facts: ['queued']
  })
  expect(await handle.interrupt!()).toEqual({ status: 'confirmed', value: { effect: 'native-scope-idle' } })
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const states = events.filter((event) => event.type === 'input.changed').map((event) => event.input)
  expect(states.filter((state) => state.inputId === 'later')).toEqual([{ inputId: 'later', facts: ['queued'] }])
  expect(states.some((state) => state.inputId === 'rejected')).toBe(false)
  expect(states.some((state) => state.outcome === 'completed')).toBe(false)
})

it('rejects a loader returning a different native identity', async () => {
  const { runtime, options } = await setup(async () => ({
    ...options,
    sessionManager: SessionManager.inMemory(options.cwd)
  }))
  expect(await runtime.open({ backendId: runtimeId('native-pi'), id: runtimeId('saved-thread') })).toMatchObject({
    status: 'rejected',
    error: { code: 'identity-mismatch' }
  })
})

it('correlates identical transformed inputs with their native entries without assigning an answer to one input', async () => {
  const { runtime, options, faux } = await setup()
  const started = gate()
  const finish = gate()
  onTestFinished(() => finish.resolve())
  faux.setResponses([
    async () => {
      started.resolve()
      await finish.promise
      return fauxAssistantMessage('initial answer')
    },
    fauxAssistantMessage('shared steering answer'),
    fauxAssistantMessage('follow-up answer')
  ])
  const nativeEvents: AgentRuntimeEvent[] = []
  const manager = SessionManager.inMemory(options.cwd)
  const handle = confirmed(
    await runtime.create({
      ...options,
      sessionManager: manager,
      settings: { steeringMode: 'all' },
      extensionFactories: [
        (pi) => {
          pi.on('input', () => ({ action: 'transform', text: 'same' }))
        }
      ],
      onEvent: (event) => nativeEvents.push(event)
    })
  )
  const events = await observe(handle)
  await handle.input.submit(input('root'))
  await started.promise
  await handle.input.submit(input('steer-1', 'steer'))
  await handle.input.submit(input('steer-2', 'steer'))
  await handle.input.submit(input('follow', 'follow-up'))
  finish.resolve()
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })

  const after = await observe(confirmed(await runtime.open(handle.thread)))
  await expect.poll(() => after[0]?.type).toBe('snapshot')
  if (after[0].type !== 'snapshot') throw new Error('Missing snapshot')
  const users = after[0].items.filter((item) => item.type === 'message' && item.role === 'user')
  expect(users).toHaveLength(4)
  expect(users.map((item) => item.type === 'message' && item.inputId)).toEqual(['root', 'steer-1', 'steer-2', 'follow'])
  expect(users.every((item) => item.type === 'message' && item.parts[0]?.text === 'same')).toBe(true)
  expect(after[0].inputs).toEqual(
    expect.arrayContaining(
      ['root', 'steer-1', 'steer-2', 'follow'].map((inputId) => ({
        inputId,
        facts: [inputId === 'root' ? 'dispatch-started' : 'queued', 'placed']
      }))
    )
  )
  expect(after[0].items.filter((item) => item.type === 'message' && item.role === 'assistant')).toEqual(
    expect.arrayContaining([expect.objectContaining({ parts: [{ type: 'text', text: 'shared steering answer' }] })])
  )
  for (const item of after[0].items) {
    if (item.type === 'message' && item.role === 'assistant') expect(item.inputId).toBeUndefined()
  }
  const placed = nativeEvents.filter((event) => event.type === 'input-placed')
  expect(placed.map((event) => event.inputId)).toEqual(['root', 'steer-1', 'steer-2', 'follow'])
  expect(new Set(placed.map((event) => event.entryId)).size).toBe(4)
  for (const event of placed) {
    expect(manager.getEntry(event.entryId)).toMatchObject({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'same' }] }
    })
  }
})

it('keeps a locally handled command failure after its later admission acknowledgement', async () => {
  const { runtime, options } = await setup()
  const handle = confirmed(
    await runtime.create({
      ...options,
      extensionFactories: [
        (pi) => {
          pi.registerCommand('fail', {
            handler: async () => {
              throw new Error('command failed')
            }
          })
          pi.on('input', () => ({ action: 'handled' }))
        }
      ]
    })
  )
  expect(await handle.input.submit(input('/fail'))).toMatchObject({ status: 'acknowledged' })
  expect(await handle.input.submit(input('handled by hook'))).toMatchObject({ status: 'acknowledged' })
  const events = await observe(handle)
  await expect.poll(() => events[0]?.type).toBe('snapshot')
  if (events[0].type !== 'snapshot') throw new Error('Missing snapshot')
  expect(events[0].items).toEqual([])
  expect(events[0].inputs).toEqual([
    {
      inputId: '/fail',
      facts: ['locally-handled'],
      outcome: 'failed',
      error: { operation: 'input', code: 'command-failed', message: 'command failed' }
    },
    { inputId: 'handled by hook', facts: ['locally-handled'] }
  ])
})

it.each(['error', 'length'] as const)(
  'does not treat native settlement after %s as input success',
  async (stopReason) => {
    const { runtime, options, faux } = await setup()
    faux.setResponses([fauxAssistantMessage('partial output', { stopReason, errorMessage: 'provider stopped' })])
    const handle = confirmed(
      await runtime.create({
        ...options,
        settings: { retry: { enabled: false } },
        compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 512 }
      })
    )
    const events = await observe(handle)
    await handle.input.submit(input('work'))
    await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
    const states = events.filter((event) => event.type === 'input.changed').map((event) => event.input)
    expect(states.at(-1)).toMatchObject({ inputId: 'work', facts: ['dispatch-started', 'placed'] })
    expect(states.some((state) => state.outcome === 'completed')).toBe(false)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'item.upsert',
          item: expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'partial output' }] })
        })
      ])
    )
  }
)

it('reopens native files after shutdown without requiring the Cherry model bridge', async () => {
  const { runtime, options, faux } = await setup()
  const manager = SessionManager.create(options.cwd, join(options.cwd, 'sessions'))
  faux.setResponses([fauxAssistantMessage('saved answer')])
  const handle = confirmed(await runtime.create({ ...options, sessionManager: manager }))
  const events = await observe(handle)
  await handle.input.submit(input('save this'))
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  confirmed(await runtime.shutdown())
  const reopened = confirmed(
    await createPiRuntime({
      backendId: handle.thread.backendId,
      load: async () => ({ ...options, sessionManager: SessionManager.open(manager.getSessionFile()!) })
    })
  )
  onTestFinished(async () => {
    await reopened.shutdown()
  })
  const restored = confirmed(await reopened.open(handle.thread))
  const frames = await observe(restored)
  await expect.poll(() => frames[0]).toMatchObject({ type: 'snapshot', activity: { state: 'idle' } })
  const snapshot = frames[0]
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  expect(snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'saved answer' }] })
    ])
  )
  expect(await handle.input.submit(input('closed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
})

it('continues an observed child through its owner, keeps one relationship, and reports the new run once', async () => {
  const { runtime, options, faux } = await setup()
  const stored = new Map<string, SessionManager>()
  const manager = SessionManager.inMemory(options.cwd)
  const childNativeEvents: AgentRuntimeEvent[] = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('subagent', { description: 'A', prompt: 'child task' }, { id: 'spawn' }), {
      stopReason: 'toolUse'
    }),
    fauxAssistantMessage('first child answer'),
    fauxAssistantMessage('parent finished')
  ])
  const parent = confirmed(
    await runtime.create({
      ...options,
      sessionManager: manager,
      subagents: {
        configure: () => ({
          onEvent: (event) => childNativeEvents.push(event),
          onSessionCreated: (session) => {
            stored.set(session.sessionId, session.sessionManager)
          }
        }),
        load: async (id) => stored.get(id)
      }
    })
  )
  const parentEvents = await observe(parent)
  await parent.input.submit(input('delegate'))
  await expect.poll(() => parentEvents.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const relation = parentEvents.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('Missing child')
  const child = confirmed(await runtime.open(relation.subagent.child))
  const second = confirmed(await runtime.open(child.thread))
  const childEvents = await observe(second)
  await expect
    .poll(() => childEvents[0])
    .toMatchObject({
      type: 'snapshot',
      items: expect.arrayContaining([
        expect.objectContaining({ parts: [{ type: 'text', text: 'first child answer' }] })
      ])
    })
  const started = gate()
  const finish = gate()
  onTestFinished(() => finish.resolve())
  faux.setResponses([
    async () => {
      started.resolve()
      await finish.promise
      return fauxAssistantMessage('intermediate child answer')
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain('add detail')
      return fauxAssistantMessage('continued child answer')
    },
    fauxAssistantMessage('parent received the result')
  ])
  expect(child.input.policies).toEqual(['steer'])
  expect(await child.input.submit(input('continue', 'follow-up'))).toMatchObject({ status: 'unsupported' })
  expect(await child.input.submit(input('continue', 'steer'))).toMatchObject({
    status: 'acknowledged',
    facts: ['dispatch-started']
  })
  await started.promise
  expect(await second.input.submit(input('add detail', 'steer'))).toMatchObject({
    status: 'acknowledged',
    facts: ['queued']
  })
  await parent.release()
  await child.release()
  expect(await child.input.submit(input('released', 'steer'))).toMatchObject({
    status: 'rejected',
    error: { code: 'closed' }
  })
  finish.resolve()
  await expect
    .poll(() =>
      childEvents.some(
        (event) =>
          event.type === 'item.upsert' &&
          event.item.type === 'message' &&
          event.item.completeness === 'complete' &&
          event.item.parts[0]?.text === 'continued child answer'
      )
    )
    .toBe(true)
  const reopenedParent = confirmed(await runtime.open(parent.thread))
  const after = await observe(reopenedParent)
  await expect
    .poll(
      () =>
        after.some(
          (event) =>
            event.type === 'item.upsert' &&
            event.item.type === 'message' &&
            event.item.parts[0]?.text === 'parent received the result' &&
            event.item.completeness === 'complete'
        ) ||
        after.some(
          (event) =>
            event.type === 'snapshot' &&
            event.items.some(
              (item) =>
                item.type === 'message' &&
                item.parts[0]?.text === 'parent received the result' &&
                item.completeness === 'complete'
            )
        )
    )
    .toBe(true)
  expect(after[0]).toMatchObject({ type: 'snapshot', subagents: [relation.subagent] })
  if (after[0].type !== 'snapshot') throw new Error('Missing parent snapshot')
  expect(after[0].subagents).toHaveLength(1)
  expect(
    manager
      .getBranch()
      .filter((entry) => entry.type === 'custom_message' && entry.customType === 'cherry.subagent-notification')
  ).toHaveLength(1)
  expect(second.thread).toEqual(relation.subagent.child)
  const childSnapshot = await observe(second)
  await expect.poll(() => childSnapshot[0]?.type).toBe('snapshot')
  if (childSnapshot[0].type !== 'snapshot') throw new Error('Missing child snapshot')
  expect(childSnapshot[0].inputs).toEqual([
    { inputId: 'continue', facts: expect.arrayContaining(['dispatch-started', 'placed']) },
    { inputId: 'add detail', facts: expect.arrayContaining(['queued', 'placed']) }
  ])
  const placed = childNativeEvents.filter((event) => event.type === 'input-placed')
  expect(placed.map((event) => event.inputId)).toEqual(['continue', 'add detail'])
  expect(new Set(placed.map((event) => event.entryId)).size).toBe(2)
  for (const event of placed) {
    expect(stored.get(child.thread.id)?.getEntry(event.entryId)).toMatchObject({
      type: 'custom_message',
      customType: 'cherry.subagent-message',
      content: event.inputId
    })
  }
})

it('joins a child continuation already loading before shutting down its owner', async () => {
  const { runtime, options, faux } = await setup()
  const loading = gate()
  const loaded = gate()
  onTestFinished(() => loaded.resolve())
  let stored: SessionManager | undefined
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('subagent', { description: 'A', prompt: 'child task' }), {
      stopReason: 'toolUse'
    }),
    fauxAssistantMessage('child done'),
    fauxAssistantMessage('parent done')
  ])
  const parent = confirmed(
    await runtime.create({
      ...options,
      subagents: {
        configure: () => ({
          onSessionCreated: (session) => {
            stored = session.sessionManager
          }
        }),
        load: async () => {
          loading.resolve()
          await loaded.promise
          return stored
        }
      }
    })
  )
  const events = await observe(parent)
  await parent.input.submit(input('delegate'))
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const relation = events.find((event) => event.type === 'subagent.upsert')
  if (relation?.type !== 'subagent.upsert' || !relation.subagent.child) throw new Error('Missing child')
  const child = confirmed(await runtime.open(relation.subagent.child))
  faux.setResponses([fauxAssistantMessage('continued')])
  const admission = child.input.submit(input('continue', 'steer'))
  await loading.promise
  let closed = false
  const shutdown = runtime.shutdown().then((result) => {
    closed = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(closed).toBe(false)
  loaded.resolve()
  expect(await admission).toMatchObject({ status: 'acknowledged' })
  expect(await shutdown).toMatchObject({ status: 'confirmed', value: { effect: 'closed' } })
  expect(await child.input.submit(input('after close', 'steer'))).toMatchObject({
    status: 'rejected',
    error: { code: 'closed' }
  })
})
