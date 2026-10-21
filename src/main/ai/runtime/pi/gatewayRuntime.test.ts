import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'
import { createPiRuntime, type PiSessionOptions } from '@cherrystudio/agent-runtime-pi'

import { gate, reply, routedModel, storingSubagentPort, subagentCall, toolCallPart } from './gatewaySubagentSupport'
import { createTestBinding } from './gatewaySupport'
import { finish, MODEL, scriptedModel, gatewayModel, tempDir, textParts } from './gatewaySupport'
import type { GatewayFixture } from './gatewaySupport'

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}
const draft = (text: string, whenBusy: 'reject' | 'steer' | 'follow-up' = 'reject') => ({
  inputId: runtimeId<'input'>(text),
  text,
  whenBusy
})
const config = async (port: GatewayFixture): Promise<PiSessionOptions> => ({
  ...(await createTestBinding({ port, model: MODEL })),
  cwd: tempDir('cwd'),
  agentDir: tempDir('agent'),
  systemPrompt: 'Test'
})
async function runtime() {
  const result = confirmed(await createPiRuntime({ backendId: runtimeId('test-pi') }))
  onTestFinished(async () => {
    await result.shutdown()
  })
  return result
}
function texts(events: ObservationPayload[]) {
  return events
    .flatMap((event) => (event.type === 'snapshot' ? event.items : event.type === 'item.upsert' ? [event.item] : []))
    .flatMap((item) => (item.type === 'message' ? item.parts.map((part) => part.text) : []))
}
async function observe(access: ThreadHandle) {
  const events: ObservationPayload[] = []
  confirmed(
    await access.observe((event) => {
      events.push(event)
    })
  )
  return events
}

describe('Pi runtime contract', () => {
  it('shares normalized streaming IDs, and releasing one access leaves execution and another observer alive', async () => {
    const model = scriptedModel([[...textParts('text', 'hello ', 'world'), finish('stop')]], 5)
    const owner = await runtime()
    const first = confirmed(await owner.create(await config(gatewayModel(model.model).upstream)))
    const second = confirmed(await owner.open(first.thread))
    const left = await observe(first)
    const right = await observe(second)
    const receipt = await first.submit(draft('go'))
    expect(receipt).toMatchObject({ status: 'acknowledged', facts: ['dispatch-started'] })
    await expect.poll(() => texts(right)).toContain('hello ')
    const leftCount = left.length
    await first.release()
    await expect.poll(() => texts(right)).toContain('hello world')
    expect(left).toHaveLength(leftCount)
    const ids = (events: ObservationPayload[]) =>
      events.flatMap((event) =>
        event.type === 'item.upsert' && event.item.type === 'message' && event.item.role === 'assistant'
          ? [event.item.ref.id]
          : []
      )
    expect(new Set(ids(right)).size).toBe(1)
    expect(ids(left)[0]).toBe(ids(right)[0])
    expect(await first.submit(draft('closed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
    expect(await owner.shutdown()).toEqual({ status: 'confirmed', value: { effect: 'closed' } })
    expect(await second.submit(draft('after shutdown'))).toMatchObject({
      status: 'rejected',
      error: { code: 'closed' }
    })
  })

  it('rejects busy ordinary input but lets native commands and input hooks handle it first', async () => {
    const hold = gate()
    const { model, calls } = routedModel(() => hold.wait(reply('done')))
    const owner = await runtime()
    const access = confirmed(
      await owner.create({
        ...(await config(gatewayModel(model).upstream)),
        extensionFactories: [
          (pi) => {
            pi.registerCommand('local', { description: 'Local command', handler: async () => {} })
            pi.on('input', async (event) => (event.text === 'handled' ? { action: 'handled' } : undefined))
          }
        ]
      })
    )
    expect(await access.submit(draft('start'))).toMatchObject({ status: 'acknowledged' })
    await hold.reached
    expect(await access.submit(draft('ordinary'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
    expect(await access.submit(draft('/local'))).toMatchObject({ status: 'acknowledged', facts: ['locally-handled'] })
    expect(await access.submit(draft('handled'))).toMatchObject({ status: 'acknowledged', facts: ['locally-handled'] })
    expect(await access.submit(draft('later', 'follow-up'))).toMatchObject({
      status: 'acknowledged',
      facts: ['queued']
    })
    hold.open()
    await expect.poll(() => calls.some((call) => call.lastText === 'later')).toBe(true)
  })

  it('reopens the same native file after shutdown and keeps its model context', async () => {
    const initial = scriptedModel([[...textParts('first', 'stored reply'), finish('stop')]])
    const settings = await config(gatewayModel(initial.model).upstream)
    const manager = SessionManager.create(settings.cwd, tempDir('sessions'))
    const firstRuntime = await runtime()
    const first = confirmed(await firstRuntime.create({ ...settings, sessionManager: manager }))
    await first.submit(draft('remember ORCHID'))
    await expect
      .poll(() => manager.getBranch().some((entry) => entry.type === 'message' && entry.message.role === 'assistant'))
      .toBe(true)
    await firstRuntime.shutdown()

    const continued = scriptedModel([[...textParts('next', 'continued reply'), finish('stop')]])
    const nextConfig = await config(gatewayModel(continued.model).upstream)
    const reopened = confirmed(
      await createPiRuntime({
        backendId: first.thread.backendId,
        load: async () => ({ ...nextConfig, sessionManager: SessionManager.open(manager.getSessionFile()!) })
      })
    )
    onTestFinished(async () => {
      await reopened.shutdown()
    })
    const handle = confirmed(await reopened.open(first.thread))
    expect(handle.thread).toEqual(first.thread)
    const events = await observe(handle)
    expect(texts(events)).toContain('stored reply')
    await handle.submit(draft('continue'))
    await expect.poll(() => continued.calls.length).toBe(1)
    expect(JSON.stringify(continued.calls[0].prompt)).toContain('ORCHID')
    expect(JSON.stringify(continued.calls[0].prompt)).toContain('stored reply')
  })

  it('refuses a loader that returns a different native identity', async () => {
    const model = scriptedModel([[...textParts('unused', 'unused'), finish('stop')]])
    const settings = await config(gatewayModel(model.model).upstream)
    const owner = confirmed(
      await createPiRuntime({
        backendId: runtimeId('test-pi'),
        load: async () => ({ ...settings, sessionManager: SessionManager.inMemory(settings.cwd) })
      })
    )
    onTestFinished(async () => {
      await owner.shutdown()
    })
    expect(await owner.open({ backendId: runtimeId('test-pi'), id: runtimeId('saved') })).toMatchObject({
      status: 'rejected',
      error: { code: 'identity-mismatch' }
    })
    expect(model.calls).toHaveLength(0)
  })

  it('shares concurrent loading and keeps shutdown pending until dispatched preflight settles', async () => {
    const loading = gate()
    const preflight = gate()
    const { model, calls } = scriptedModel([[...textParts('answer', 'done'), finish('stop')]])
    const sessionOptions = {
      ...(await config(gatewayModel(model).upstream)),
      sessionManager: SessionManager.inMemory(tempDir('saved'), { id: 'saved' }),
      extensionFactories: [
        (pi: Parameters<NonNullable<PiSessionOptions['extensionFactories']>[number]>[0]) => {
          pi.on('input', async () => {
            await preflight.wait(undefined)
          })
        }
      ]
    }
    const owner = confirmed(
      await createPiRuntime({ backendId: runtimeId('test-pi'), load: async () => loading.wait(sessionOptions) })
    )
    onTestFinished(async () => {
      loading.open()
      preflight.open()
      await owner.shutdown()
    })
    const ref = { backendId: runtimeId<'backend'>('test-pi'), id: runtimeId<'thread'>('saved') }
    const a = owner.open(ref)
    const b = owner.open(ref)
    await loading.reached
    loading.open()
    const first = confirmed(await a)
    const second = confirmed(await b)
    const events = await observe(second)
    const submission = first.submit(draft('pending'))
    await preflight.reached
    let closed = false
    const closing = owner.shutdown().then((result) => {
      closed = true
      return result
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(closed).toBe(false)
    expect(await second.submit(draft('sealed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
    preflight.open()
    expect(await submission).toMatchObject({ status: 'acknowledged' })
    expect(await closing).toEqual({ status: 'confirmed', value: { effect: 'closed' } })
    expect(calls.length).toBeLessThanOrEqual(1)
    expect(events.some((event) => event.type === 'input.changed' && event.input.inputId === 'pending')).toBe(true)
  })

  it('keeps child observations connected across native session reconstruction on continuation', async () => {
    const child = storingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'continue' ? 'child second' : 'child first')
      if (lastText === 'start')
        return [subagentCall('spawn', { description: 'A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (lastText === 'again')
        return [
          toolCallPart('continue-call', 'message_subagent', { id: child.subagents[0].sessionId, message: 'continue' }),
          finish('tool-calls')
        ]
      return reply('parent done')
    })
    const owner = await runtime()
    const root = confirmed(
      await owner.create({ ...(await config(gatewayModel(model).upstream)), subagents: child.port })
    )
    const parentEvents = await observe(root)
    await root.submit(draft('start'))
    await expect.poll(() => texts(parentEvents)).toContain('parent done')
    const relationship = parentEvents.find((event) => event.type === 'delegation.upsert')
    if (relationship?.type !== 'delegation.upsert') throw new Error('Missing child relationship')
    const childAccess = confirmed(await owner.open(relationship.delegation.child))
    const childEvents = await observe(childAccess)
    expect(childAccess.inputPolicies).toEqual([])
    expect(texts(childEvents)).toContain('child first')
    await expect
      .poll(() => parentEvents.at(-1))
      .toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
    await root.submit(draft('again'))
    await expect.poll(() => texts(childEvents)).toContain('child second')
    expect(childEvents).toContainEqual({ type: 'gap', reason: 'mapping-reset' })
    const relations = parentEvents.filter((event) => event.type === 'delegation.upsert')
    expect(relations).toHaveLength(2)
    expect(relations[1].delegation.child).toEqual(relationship.delegation.child)
    expect(relations[1].delegation.ref).not.toEqual(relationship.delegation.ref)
  })
})
