import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  type ObservationPayload,
  type OperationResult,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'

import { createPiRuntime, type PiSessionOptions } from '../src'
import type { TestStream } from './sessionSupport'
import { assistantReply, createTestBinding, MODEL, scriptedModel, tempDir } from './sessionSupport'
import { gate, reply, routedModel, storingSubagentPort, subagentCall, toolCallPart } from './subagentSupport'

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
const config = async (port: TestStream): Promise<PiSessionOptions> => ({
  ...(await createTestBinding({ stream: port, model: MODEL })),
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
    .flatMap((event) =>
      event.type === 'snapshot' ? event.messages : event.type === 'message.upsert' ? [event.message] : []
    )
    .flatMap((item) =>
      item.parts.flatMap((part) => (part.type === 'text' || part.type === 'reasoning' ? [part.text] : []))
    )
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
  it('shares concurrent loading and keeps shutdown pending until dispatched preflight settles', async () => {
    const loading = gate()
    const preflight = gate()
    const { model, calls } = scriptedModel([assistantReply([{ type: 'text', text: 'done' }])])
    const sessionOptions = {
      ...(await config(model)),
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
    const submission = first.input.submit(draft('pending'))
    await preflight.reached
    let closed = false
    const closing = owner.shutdown().then((result) => {
      closed = true
      return result
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(closed).toBe(false)
    expect(await second.input.submit(draft('sealed'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
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
        return assistantReply([subagentCall('spawn', { description: 'A', prompt: 'TASK-A' })], 'toolUse')
      if (lastText === 'again')
        return assistantReply(
          [
            toolCallPart('continue-call', 'message_subagent', { id: child.subagents[0].sessionId, message: 'continue' })
          ],
          'toolUse'
        )
      return reply('parent done')
    })
    const owner = await runtime()
    const root = confirmed(await owner.create({ ...(await config(model)), subagents: child.port }))
    const parentEvents = await observe(root)
    await root.input.submit(draft('start'))
    await expect.poll(() => texts(parentEvents)).toContain('parent done')
    const relationship = parentEvents.find((event) => event.type === 'subagent.upsert')
    if (relationship?.type !== 'subagent.upsert') throw new Error('Missing child relationship')
    const childAccess = confirmed(await owner.open(relationship.subagent.child!))
    const childEvents = await observe(childAccess)
    expect(childAccess.input.policies).toEqual(['steer'])
    expect(texts(childEvents)).toContain('child first')
    await expect
      .poll(() => parentEvents.at(-1))
      .toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
    await root.input.submit(draft('again'))
    await expect.poll(() => texts(childEvents)).toContain('child second')
    expect(childEvents).toContainEqual({ type: 'gap', reason: 'mapping-reset' })
    const relations = parentEvents.filter((event) => event.type === 'subagent.upsert')
    expect(relations[1].subagent.child!).toEqual(relationship.subagent.child!)
    expect(relations[1].subagent.id).toEqual(relationship.subagent.id)
  })
})
