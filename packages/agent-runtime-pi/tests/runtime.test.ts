import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
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

import { createPiRuntime, type PiRuntimeOptions } from '../src'

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

it('shares streamed message identities across handles while releasing only one observation', async () => {
  const { runtime, options, faux } = await setup()
  faux.setResponses([fauxAssistantMessage('native output for both handles')])
  const first = confirmed(await runtime.create(options))
  const second = confirmed(await runtime.open(first.thread))
  const left = await observe(first)
  const right = await observe(second)
  expect(await first.submit(input('question'))).toMatchObject({ status: 'acknowledged', facts: ['dispatch-started'] })
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
      parts: [{ type: 'text', text: 'native output for both handles', state: 'done' }]
    })
  expect(left).toHaveLength(count)
  expect(await first.submit(input('released'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
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
  await handle.submit(input('start'))
  await reached
  expect(await handle.submit(input('/local'))).toMatchObject({ status: 'acknowledged', facts: ['locally-handled'] })
  expect(commands).toBe(1)
  expect(await handle.submit(input('rejected'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(manager.buildSessionContext().messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(await handle.submit(input('later', 'follow-up'))).toMatchObject({ status: 'acknowledged', facts: ['queued'] })
  expect(await handle.interrupt!()).toEqual({ status: 'confirmed', value: { effect: 'native-scope-idle' } })
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

it('reopens native files after shutdown without requiring the Cherry model bridge', async () => {
  const { runtime, options, faux } = await setup()
  const manager = SessionManager.create(options.cwd, join(options.cwd, 'sessions'))
  faux.setResponses([fauxAssistantMessage('saved answer')])
  const handle = confirmed(await runtime.create({ ...options, sessionManager: manager }))
  const events = await observe(handle)
  await handle.submit(input('save this'))
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
      expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'saved answer', state: 'done' }] })
    ])
  )
  expect(await handle.submit(input('closed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
})
