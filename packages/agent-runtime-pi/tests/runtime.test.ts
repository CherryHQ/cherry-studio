import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
  Type,
  type FauxResponseStep
} from '@earendil-works/pi-ai'
import { defineTool, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'

import { createPiRuntime, type AgentRuntimeEvent, type PiRuntimeOptions } from '../src'
import { createTestBehavior } from './sessionSupport'

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
  const options = {
    cwd,
    agentDir: cwd,
    modelRuntime,
    model: modelRuntime.getModel('faux', 'faux-1')!,
    behavior: createTestBehavior({ provider: 'faux', id: 'faux-1' })
  }
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
      (event): event is Extract<ObservationPayload, { type: 'message.upsert' }> =>
        event.type === 'message.upsert' && event.message.role === 'assistant'
    )
  await expect.poll(() => messages(right).length).toBeGreaterThan(0)
  expect(messages(left).map((event) => event.message.id)).toEqual(messages(right).map((event) => event.message.id))
  await first.release()
  const count = left.length
  await expect
    .poll(() => messages(right).at(-1)?.message)
    .toMatchObject({
      metadata: { completeness: 'complete' },
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
          pi.on('input', (event) => (event.text === 'handled' ? { action: 'handled' } : undefined))
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
  expect(await handle.input.submit(input('handled'))).toMatchObject({
    status: 'acknowledged',
    facts: ['locally-handled']
  })
  expect(await handle.pi.compact()).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(await handle.input.submit(input('rejected'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(manager.buildSessionContext().messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(await handle.input.submit(input('later', 'follow-up'))).toMatchObject({
    status: 'acknowledged',
    facts: ['queued']
  })
  expect(await handle.interrupt!()).toEqual({ status: 'confirmed', value: undefined })
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const states = events.filter((event) => event.type === 'input.changed').map((event) => event.input)
  expect(states.filter((state) => state.inputId === 'later')).toEqual([{ inputId: 'later', facts: ['queued'] }])
  expect(states.some((state) => state.inputId === 'rejected')).toBe(false)
  expect(states.some((state) => state.outcome === 'completed')).toBe(false)
  expect(states.findLast((state) => state.inputId === 'start')).toMatchObject({
    outcome: 'aborted'
  })
  expect(handle.pi.cancelQueuedInputs()).toEqual({ status: 'confirmed', value: ['later'] })
  const after = await observe(handle)
  await expect
    .poll(() => after[0])
    .toMatchObject({
      type: 'snapshot',
      inputs: expect.arrayContaining([{ inputId: 'later', facts: ['queued'], outcome: 'aborted' }])
    })
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

it('does not dispatch a root input whose preflight resumes during shutdown', async () => {
  const { runtime, options, faux } = await setup()
  const entered = gate()
  const release = gate()
  onTestFinished(() => release.resolve())
  let requests = 0
  faux.setResponses([
    () => {
      requests += 1
      return fauxAssistantMessage('must not run')
    }
  ])
  const handle = confirmed(
    await runtime.create({
      ...options,
      extensionFactories: [
        (pi) => {
          pi.on('input', async () => {
            entered.resolve()
            await release.promise
          })
        }
      ]
    })
  )
  const submission = handle.input.submit(input('work'))
  await entered.promise
  const closing = runtime.shutdown()
  release.resolve()
  await submission
  confirmed(await closing)
  expect(requests).toBe(0)
})

it('correlates identical transformed inputs and shares one response across batched steering', async () => {
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
  const users = after[0].messages.filter((item) => item.role === 'user')
  expect(users).toHaveLength(4)
  expect(users.map((item) => item.metadata?.inputId)).toEqual(['root', 'steer-1', 'steer-2', 'follow'])
  expect(users.every((item) => item.parts.find((part) => part.type === 'text')?.text === 'same')).toBe(true)
  expect(after[0].inputs).toEqual(
    expect.arrayContaining(
      ['root', 'steer-1', 'steer-2', 'follow'].map((inputId) =>
        expect.objectContaining({
          inputId,
          facts: [inputId === 'root' ? 'dispatch-started' : 'queued', 'placed'],
          outcome: 'completed'
        })
      )
    )
  )
  expect(after[0].messages.filter((item) => item.role === 'assistant')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ parts: [expect.objectContaining({ type: 'text', text: 'shared steering answer' })] })
    ])
  )
  for (const item of after[0].messages) {
    if (item.role === 'assistant') expect(item.metadata?.inputId).toBeUndefined()
  }
  expect(
    after[0].messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
  ).toEqual(['initial answer', 'shared steering answer', 'follow-up answer'])
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
  expect(events[0].messages).toEqual([])
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

it('attributes a final answer to the original input and steering delivered after a tool call', async () => {
  const { runtime, options, faux } = await setup()
  const executing = gate()
  const finish = gate()
  onTestFinished(() => finish.resolve())
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('hold', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('answer using both inputs')
  ])
  const handle = confirmed(
    await runtime.create({
      ...options,
      tools: [
        defineTool({
          name: 'hold',
          label: 'Hold',
          description: 'Hold the tool boundary',
          parameters: Type.Object({}),
          execute: async () => {
            executing.resolve()
            await finish.promise
            return { content: [{ type: 'text', text: 'tool finished' }], details: {} }
          }
        })
      ]
    })
  )
  const events = await observe(handle)
  await handle.input.submit(input('root'))
  await executing.promise
  await handle.input.submit(input('steering', 'steer'))
  expect(events.filter((event) => event.type === 'input.changed').some((event) => event.input.outcome)).toBe(false)
  finish.resolve()
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const snapshotEvents = await observe(handle)
  await expect.poll(() => snapshotEvents[0]?.type).toBe('snapshot')
  const snapshot = snapshotEvents[0]
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  expect(snapshot.inputs).toHaveLength(2)
  expect(snapshot.inputs.every((state) => state.outcome === 'completed')).toBe(true)
  expect(snapshot.messages.findLast((item) => item.role === 'assistant')).toMatchObject({
    parts: [{ type: 'text', text: 'answer using both inputs' }]
  })
})

it('does not change an answered input when a queued follow-up fails', async () => {
  const { runtime, options, faux } = await setup()
  const started = gate()
  const finish = gate()
  onTestFinished(() => finish.resolve())
  faux.setResponses([
    async () => {
      started.resolve()
      await finish.promise
      return fauxAssistantMessage('root answer')
    },
    fauxAssistantMessage('follow-up failed', { stopReason: 'error', errorMessage: 'unsupported model' })
  ])
  const handle = confirmed(await runtime.create({ ...options, settings: { retry: { enabled: false } } }))
  const events = await observe(handle)
  await handle.input.submit(input('root'))
  await started.promise
  await handle.input.submit(input('follow', 'follow-up'))
  finish.resolve()
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const states = events.filter((event) => event.type === 'input.changed')
  expect(states.findLast((event) => event.input.inputId === 'root')?.input.outcome).toBe('completed')
  expect(states.findLast((event) => event.input.inputId === 'follow')?.input.outcome).toBe('failed')
})

it.each(['stop', 'error'] as const)(
  'keeps input pending until a settle continuation ends with %s',
  async (stopReason) => {
    const { runtime, options, faux } = await setup()
    const boundary = gate()
    const resume = gate()
    onTestFinished(() => resume.resolve())
    faux.setResponses([
      fauxAssistantMessage('provisional answer'),
      fauxAssistantMessage('final response', {
        stopReason,
        ...(stopReason === 'error' && { errorMessage: 'model failed' })
      })
    ])
    let continued = false
    const handle = confirmed(
      await runtime.create({
        ...options,
        settings: { retry: { enabled: false } },
        extensionFactories: [
          (pi) => {
            pi.on('agent_before_settle', async () => {
              if (continued) return
              continued = true
              boundary.resolve()
              await resume.promise
              return {
                continue: true,
                entries: [
                  { type: 'custom_message', customType: 'result', content: 'Continue with this result', display: false }
                ]
              }
            })
          }
        ]
      })
    )
    const events = await observe(handle)
    await handle.input.submit(input('work'))
    await boundary.promise
    expect(events.filter((event) => event.type === 'input.changed').some((event) => event.input.outcome)).toBe(false)
    resume.resolve()
    await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
    const terminal = events.filter((event) => event.type === 'input.changed' && event.input.outcome)
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({
      input: {
        inputId: 'work',
        outcome: stopReason === 'stop' ? 'completed' : 'failed'
      }
    })
    if (terminal[0].type !== 'input.changed') throw new Error('Missing input outcome')
    expect(
      events.findLast((event) => event.type === 'message.upsert' && event.message.role === 'assistant')
    ).toMatchObject({
      message: { parts: [{ type: 'text', text: 'final response' }] }
    })
  }
)

it.each(['error', 'length', 'toolUse'] as const)(
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
    expect(states.at(-1)).toMatchObject({
      inputId: 'work',
      facts: ['dispatch-started', 'placed'],
      outcome: stopReason === 'error' ? 'failed' : 'unanswered',
      error: {
        code: stopReason === 'error' ? 'model-error' : stopReason === 'length' ? 'output-truncated' : 'no-final-answer'
      }
    })
    expect(states.some((state) => state.outcome === 'completed')).toBe(false)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.upsert',
          message: expect.objectContaining({
            role: 'assistant',
            parts: [expect.objectContaining({ type: 'text', text: 'partial output' })]
          })
        })
      ])
    )
  }
)

it('reports provider failure without a native retry and accepts a new input afterward', async () => {
  const { runtime, options, faux } = await setup()
  faux.setResponses([
    fauxAssistantMessage('temporary failure', { stopReason: 'error', errorMessage: '429 rate limit exceeded' }),
    fauxAssistantMessage('recovered answer')
  ])
  const handle = confirmed(await runtime.create({ ...options, settings: { retry: { enabled: true } } }))
  const events = await observe(handle)
  await handle.input.submit(input('first'))
  await handle.pi.settled()
  expect(faux.state.callCount).toBe(1)
  await expect
    .poll(() => events.filter((event) => event.type === 'input.changed').at(-1)?.input)
    .toMatchObject({
      inputId: 'first',
      outcome: 'failed',
      error: { code: 'model-error' }
    })
  await handle.input.submit(input('next'))
  await handle.pi.settled()
  expect(faux.state.callCount).toBe(2)
  await expect
    .poll(() => events.filter((event) => event.type === 'input.changed').at(-1)?.input)
    .toMatchObject({
      inputId: 'next',
      outcome: 'completed'
    })
})

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
  expect(snapshot.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        parts: [expect.objectContaining({ type: 'text', text: 'saved answer' })]
      })
    ])
  )
  expect(await handle.input.submit(input('closed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
})

it('continues an observed child through its owner, keeps one relationship, and reports the new run once', async () => {
  const { runtime, options, faux } = await setup()
  const manager = SessionManager.inMemory(options.cwd)
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
      sessionManager: manager
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
      messages: expect.arrayContaining([
        expect.objectContaining({ parts: [expect.objectContaining({ type: 'text', text: 'first child answer' })] })
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
  expect(await child.input.submit(input('continue', 'follow-up'))).toMatchObject({ status: 'unsupported' })
  expect(await child.input.submit(input('continue', 'steer'))).toMatchObject({
    status: 'acknowledged',
    facts: ['dispatch-started']
  })
  await started.promise
  const steering = second.input.submit(input('add detail', 'steer'))
  await parent.release()
  await child.release()
  expect(await child.input.submit(input('released', 'steer'))).toMatchObject({
    status: 'rejected',
    error: { code: 'closed' }
  })
  finish.resolve()
  expect(await steering).toMatchObject({ status: 'acknowledged', facts: ['queued'] })
  await expect
    .poll(() =>
      childEvents.some(
        (event) =>
          event.type === 'message.upsert' &&
          event.message.metadata?.completeness === 'complete' &&
          event.message.parts.find((part) => part.type === 'text')?.text === 'continued child answer'
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
            event.type === 'message.upsert' &&
            event.message.parts.find((part) => part.type === 'text')?.text === 'parent received the result' &&
            event.message.metadata?.completeness === 'complete'
        ) ||
        after.some(
          (event) =>
            event.type === 'snapshot' &&
            event.messages.some(
              (item) =>
                item.parts.find((part) => part.type === 'text')?.text === 'parent received the result' &&
                item.metadata?.completeness === 'complete'
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
    expect.objectContaining({
      inputId: 'continue',
      facts: expect.arrayContaining(['dispatch-started', 'placed']),
      outcome: 'completed'
    }),
    expect.objectContaining({
      inputId: 'add detail',
      facts: expect.arrayContaining(['queued', 'placed']),
      outcome: 'completed'
    })
  ])
  const placed = second.pi.archive().messages.filter((message) => message.metadata?.inputId)
  expect(placed.map((message) => message.metadata?.inputId)).toEqual(['continue', 'add detail'])
  expect(new Set(placed.map((message) => message.id)).size).toBe(2)
})

// A tool update must change its part, without splitting or reordering the surrounding native message.
it('streams interleaved content and preliminary tool output in the same native message', async () => {
  const { runtime, options, faux } = await setup()
  const finish = gate()
  onTestFinished(() => finish.resolve())
  faux.setResponses([
    fauxAssistantMessage(
      [
        { type: 'thinking', thinking: 'Reason first', thinkingSignature: 'native-signature' },
        { type: 'text', text: 'Before tool' },
        fauxToolCall('progress', {}, { id: 'native-call' }),
        { type: 'text', text: 'After tool' }
      ],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('Final answer')
  ])
  const handle = confirmed(
    await runtime.create({
      ...options,
      tools: [
        defineTool({
          name: 'progress',
          label: 'Progress',
          description: 'Report progress',
          parameters: Type.Object({}),
          execute: async (_id, _args, _signal, update) => {
            update?.({ content: [{ type: 'text', text: 'FIRST' }], details: { stage: 1 } })
            await finish.promise
            return { content: [{ type: 'text', text: 'LAST' }], details: { stage: 2 } }
          }
        })
      ]
    })
  )
  const events = await observe(handle)
  await handle.input.submit(input('stream content'))
  const latest = () =>
    events
      .filter((event) => event.type === 'message.upsert')
      .map((event) => event.message)
      .findLast((message) => message.parts.some((part) => part.type === 'dynamic-tool'))!
  await expect
    .poll(() => latest()?.parts[2])
    .toMatchObject({
      toolCallId: 'native-call',
      preliminary: true,
      output: { content: [{ type: 'text', text: 'FIRST' }], details: { stage: 1 } }
    })
  const partial = latest()
  expect(partial.parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'dynamic-tool', 'text'])
  expect(partial.parts[0]).toMatchObject({
    text: 'Reason first',
    providerMetadata: { pi: { thinkingSignature: 'native-signature' } }
  })
  finish.resolve()
  await expect
    .poll(() => latest().parts[2])
    .toMatchObject({ preliminary: false, output: { content: [{ type: 'text', text: 'LAST' }] } })
  expect(latest().id).toBe(partial.id)
  expect(partial.parts[2]).toMatchObject({ preliminary: true })
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const archive = handle.pi.archive()
  const committed = archive.messages.find((message) => message.parts.some((part) => part.type === 'dynamic-tool'))!
  expect(committed.parts).toEqual(latest().parts)
  expect(archive.messages.filter((message) => message.role === 'assistant')).toHaveLength(2)
})

it('reads native context without submitting work and rejects released access', async () => {
  const { runtime, options } = await setup()
  const handle = confirmed(await runtime.create({ ...options, systemPrompt: 'Native context contract' }))
  const events = await observe(handle)
  const before = confirmed(await handle.contextUsage())
  expect(before.contextWindow).toBe(options.model.contextWindow)
  expect(before.used?.precision).toBe('estimated')
  expect(before.breakdown?.categories.map((row) => row.key)).toContain('messages')
  const messages = events.filter((event) => event.type === 'message.upsert')
  expect(confirmed(await handle.contextUsage())).toEqual(before)
  await Promise.resolve()
  expect(events.filter((event) => event.type === 'message.upsert')).toEqual(messages)
  expect(events.filter((event) => event.type === 'activity.changed' && event.activity.state === 'active')).toEqual([])
  await handle.release()
  expect(await handle.contextUsage()).toMatchObject({ status: 'rejected', error: { code: 'released' } })
})

it.each(['deferred', 'codemode'] as const)(
  'retains prepared %s resource provenance instead of recounting discovered files',
  async (exposure) => {
    const { runtime, options, faux } = await setup()
    const skillDir = join(options.cwd, 'skills', 'example')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: example\ndescription: A loaded summary\n---\nFull body is not in the catalog.'
    )
    writeFileSync(join(options.cwd, 'AGENTS.md'), 'Use project instructions.')
    faux.setResponses([fauxAssistantMessage('ready')])
    const handle = confirmed(
      await runtime.create({
        ...options,
        contextFiles: true,
        skillPaths: [skillDir],
        builtinTools: ['read'],
        tools: [
          defineTool({
            name: 'direct_lookup',
            label: 'Direct',
            description: 'Loaded external schema',
            parameters: Type.Object({}),
            contextSource: { kind: 'mcp-tools', source: 'direct-server' },
            execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} })
          }),
          defineTool({
            name: 'external_lookup',
            label: 'External',
            description: 'Deferred external schema',
            parameters: Type.Object({}),
            exposure,
            contextSource: { kind: 'mcp-tools', source: 'test-server' },
            execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} })
          })
        ]
      })
    )
    const events = await observe(handle)
    await handle.input.submit(input('prepare resource context'))
    await expect
      .poll(() => events.some((event) => event.type === 'activity.changed' && event.activity.state === 'idle'))
      .toBe(true)
    const before = confirmed(await handle.contextUsage())
    expect(before.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'memory-files',
          source: join(options.cwd, 'AGENTS.md'),
          state: 'loaded',
          count: { precision: 'estimated', tokens: expect.any(Number) }
        }),
        expect.objectContaining({
          category: 'skills',
          name: 'example',
          source: join(skillDir, 'SKILL.md'),
          state: 'loaded'
        }),
        expect.objectContaining({
          category: 'mcp-tools',
          name: 'external_lookup',
          source: 'test-server',
          state: 'deferred',
          count: { precision: 'estimated', tokens: expect.any(Number) }
        })
      ])
    )
    expect(before.breakdown?.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'memory-files', occupancy: 'included', tokens: expect.any(Number) }),
        expect.objectContaining({ key: 'skills', occupancy: 'included', tokens: expect.any(Number) }),
        expect.objectContaining({ key: 'mcp-tools', occupancy: 'deferred' })
      ])
    )
    expect(before.resources).toContainEqual(
      expect.objectContaining({
        category: 'mcp-tools',
        name: 'direct_lookup',
        source: 'direct-server',
        state: 'loaded'
      })
    )
    writeFileSync(join(options.cwd, 'AGENTS.md'), 'Changed after the request '.repeat(100))
    expect(confirmed(await handle.contextUsage())).toEqual(before)
  }
)

it('publishes a local extension model switch to existing and newly attached observers', async () => {
  const { runtime, options } = await setup()
  const provider = fauxProvider({
    models: [
      { id: 'wide', contextWindow: 128_000 },
      { id: 'small', contextWindow: 64_000 }
    ]
  })
  options.modelRuntime.registerNativeProvider(provider.provider)
  await options.modelRuntime.refresh({ allowNetwork: false })
  let switched = false
  const handle = confirmed(
    await runtime.create({
      ...options,
      model: options.modelRuntime.getModel('faux', 'wide')!,
      extensionFactories: [
        (pi) => {
          pi.registerCommand('smaller', {
            handler: async () => {
              switched = await pi.setModel(options.modelRuntime.getModel('faux', 'small')!)
            }
          })
        }
      ]
    })
  )
  const events = await observe(handle)
  await expect
    .poll(() => events[0])
    .toMatchObject({
      type: 'snapshot',
      contextUsage: { status: 'confirmed', value: { model: 'wide', contextWindow: 128_000 } }
    })
  expect(await handle.input.submit(input('/smaller'))).toMatchObject({
    status: 'acknowledged',
    facts: ['locally-handled']
  })
  await handle.pi.settled()
  expect(switched).toBe(true)
  const attached = await observe(confirmed(await runtime.open(handle.thread)))
  await expect
    .poll(() => attached[0])
    .toMatchObject({
      type: 'snapshot',
      contextUsage: { status: 'confirmed', value: { model: 'small', contextWindow: 64_000 } }
    })
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'context.changed',
      result: expect.objectContaining({
        status: 'confirmed',
        value: expect.objectContaining({ model: 'small', contextWindow: 64_000 })
      })
    })
  )
  expect(provider.state.callCount).toBe(0)
})
