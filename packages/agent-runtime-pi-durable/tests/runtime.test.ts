import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
  type FauxResponseStep
} from '@earendil-works/pi-ai'
import { configure, createRegistry, defineExtension, defineTool, MemoryStorage } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { describe, expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime, type PiDurableRuntimeOptions, type PiDurableThreadHandle } from '../src'

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
const sessionOptions = {
  ownership: { kind: 'ownerless' as const },
  agent: { model: { provider: 'faux', modelId: 'faux-1' } }
}
function blocked() {
  let reach!: () => void
  const reached = new Promise<void>((resolve) => {
    reach = resolve
  })
  const step: FauxResponseStep = (_context, options) =>
    new Promise((_, reject) => {
      reach()
      const signal = options!.signal!
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  return { reached, step }
}
async function setup(openStorage: PiDurableRuntimeOptions['openStorage'] = async () => new MemoryStorage()) {
  const faux = fauxProvider({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } })
  const models = createModels()
  models.setProvider(faux.provider)
  const errors: unknown[] = []
  const registry = createRegistry()
  const options: PiDurableRuntimeOptions = {
    backendId: runtimeId('test-durable'),
    openStorage,
    harness: { models, registry, onReport: (error) => errors.push(error) },
    onError: (error) => errors.push(error)
  }
  const runtime = confirmed(await createPiDurableRuntime(options))
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  return { runtime, faux, options, errors, registry }
}
async function observe(access: PiDurableThreadHandle) {
  const events: ObservationPayload[] = []
  confirmed(
    await access.observe((event) => {
      events.push(event)
    })
  )
  return events
}
function current(events: ObservationPayload[]) {
  return events.filter((event) => event.type === 'snapshot').at(-1)
}

describe('Pi Durable runtime contract', () => {
  it('streams a current view shared by accesses, isolates release, and reports durable input completion', async () => {
    const { runtime, faux } = await setup()
    faux.setResponses([fauxAssistantMessage('a sufficiently long streaming answer')])
    const first = confirmed(await runtime.create(sessionOptions))
    const second = confirmed(await runtime.open(first.thread))
    const left = await observe(first)
    const right = await observe(second)
    const receipt = await first.submit(draft('question'))
    expect(receipt).toMatchObject({ status: 'acknowledged', nativeInput: { session: first.thread } })
    await expect
      .poll(() =>
        current(right)?.messages.some((item) => item.role === 'assistant' && item.metadata?.completeness === 'partial')
      )
      .toBe(true)
    expect(current(left)?.messages.map((item) => item.id)).toEqual(current(right)?.messages.map((item) => item.id))
    await first.release()
    const releasedCount = left.length
    await expect
      .poll(() =>
        current(right)?.messages.some(
          (item) =>
            item.role === 'assistant' &&
            item.metadata?.completeness === 'complete' &&
            (item.parts[0]?.type === 'text' ? item.parts[0].text : undefined) === 'a sufficiently long streaming answer'
        )
      )
      .toBe(true)
    expect(left).toHaveLength(releasedCount)
    expect(current(right)?.messages.filter((item) => item.role === 'assistant')).toHaveLength(1)
    if (receipt.status !== 'acknowledged' || !receipt.nativeInput) throw new Error('No native receipt')
    await expect
      .poll(async () => confirmed(await second.lookupInput({ by: 'native-ref', ref: receipt.nativeInput! })))
      .toMatchObject({ found: true, input: { outcome: 'completed' } })
    expect(await first.submit(draft('released'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  })

  it('deduplicates queued input, rejects busy input without admission, and scopes withdrawal to its session', async () => {
    const { runtime, faux } = await setup()
    const hold = blocked()
    faux.setResponses([hold.step])
    const session = confirmed(await runtime.create(sessionOptions))
    const other = confirmed(await runtime.create(sessionOptions))
    await session.submit(draft('start'))
    await hold.reached
    expect(await session.submit({ ...draft('rejected'), deduplicationKey: 'rejected' })).toMatchObject({
      status: 'rejected',
      error: { code: 'busy' }
    })
    expect(confirmed(await session.lookupInput({ by: 'deduplication-key', key: 'rejected' }))).toEqual({ found: false })
    const input = { ...draft('queued', 'follow-up'), deduplicationKey: 'queue-key' }
    const first = await session.submit(input)
    const duplicate = await session.submit(input)
    expect(first).toMatchObject({ status: 'acknowledged', facts: ['accepted', 'queued'] })
    expect(duplicate).toEqual(first)
    if (first.status !== 'acknowledged' || !first.nativeInput) throw new Error('No native receipt')
    expect(await other.retractInput(first.nativeInput)).toMatchObject({
      status: 'rejected',
      error: { code: 'not-found' }
    })
    expect(await session.retractInput(first.nativeInput)).toEqual({
      status: 'confirmed',
      value: { effect: 'withdrawn' }
    })
    expect(confirmed(await session.lookupInput({ by: 'deduplication-key', key: 'queue-key' }))).toMatchObject({
      found: true,
      input: { outcome: 'unanswered' }
    })
    expect(await session.interrupt!()).toEqual({ status: 'confirmed', value: { effect: 'native-scope-idle' } })
  })

  it('preserves an admission receipt when the subsequent native status read fails', async () => {
    class BrokenStatusStorage extends MemoryStorage {
      override async submission(): Promise<never> {
        throw new Error('status read unavailable')
      }
    }
    const { runtime, faux } = await setup(async () => new BrokenStatusStorage())
    faux.setResponses([fauxAssistantMessage('answer')])
    const session = confirmed(await runtime.create(sessionOptions))
    const result = await session.submit(draft('admitted before read failure'))
    expect(result).toMatchObject({
      status: 'acknowledged',
      nativeInput: { session: session.thread },
      facts: ['accepted']
    })
  })

  it('discovers native owned conversations and observes their output independently of the parent', async () => {
    const { runtime, faux, registry } = await setup()
    registry.install(
      defineExtension({
        name: 'delegate',
        tools: [
          defineTool({
            name: 'delegate',
            description: 'Run a child',
            parameters: Type.Object({}),
            async execute(_args, api, context) {
              const child = await api.commit(async (tx) => {
                const record = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } })
                await configure(tx, record.id, { model: { provider: 'faux', modelId: 'faux-1' }, tools: [] })
                return record
              }, context)
              const conversation = await api.conversation(child.id, context)
              await (await conversation!.submit({ type: 'input', content: 'child question' }, context)).wait(context)
              return { output: [{ type: 'text', text: 'child finished' }] }
            }
          })
        ]
      })
    )
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('delegate', {}, { id: 'delegation-call' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('independent child output'),
      fauxAssistantMessage('parent finished')
    ])
    const parent = confirmed(await runtime.create(sessionOptions))
    const parentEvents = await observe(parent)
    await parent.submit(draft('delegate now'))
    await expect.poll(() => parentEvents.some((event) => event.type === 'delegation.upsert')).toBe(true)
    const relationship = parentEvents.find((event) => event.type === 'delegation.upsert')
    if (relationship?.type !== 'delegation.upsert') throw new Error('No child reference')
    const child = confirmed(await runtime.open(relationship.delegation.child))
    const events = await observe(child)
    await parent.release()
    await expect
      .poll(
        () =>
          current(events)?.messages.some(
            (item) =>
              (item.parts[0]?.type === 'text' ? item.parts[0].text : undefined) === 'independent child output' &&
              item.metadata?.completeness === 'complete'
          ),
        { timeout: 5000 }
      )
      .toBe(true)
    expect(child.thread).not.toEqual(parent.thread)
  })

  it('closes without cancelling durable work, reopens for observation only, then resumes explicitly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'durable-runtime-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const { runtime, faux, options } = await setup(() => openNodeSqliteStorage(join(directory, 'session.sqlite')))
    const hold = blocked()
    faux.setResponses([hold.step])
    const session = confirmed(await runtime.create(sessionOptions))
    const receipt = await session.submit({ ...draft('survive restart'), deduplicationKey: 'restart-key' })
    await hold.reached
    expect(receipt.status).toBe('acknowledged')
    expect(await runtime.shutdown()).toEqual({ status: 'confirmed', value: { effect: 'closed' } })
    expect(await session.submit(draft('too late'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })

    faux.setResponses([fauxAssistantMessage('resumed answer')])
    const reopened = confirmed(await createPiDurableRuntime(options))
    onTestFinished(async () => {
      await reopened.shutdown()
    })
    const [a, b] = await Promise.all([reopened.open(session.thread), reopened.open(session.thread)])
    const access = confirmed(a)
    const events = await observe(confirmed(b))
    const before = faux.state.callCount
    const input = confirmed(await access.lookupInput({ by: 'deduplication-key', key: 'restart-key' }))
    expect(input).toMatchObject({ found: true, input: { facts: ['accepted', 'placed'] } })
    if (input.found) expect(input.input.outcome).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(faux.state.callCount).toBe(before)
    expect(await reopened.resume()).toEqual({
      status: 'confirmed',
      value: { scope: 'runtime', effect: 'scheduling-enabled' }
    })
    await expect
      .poll(() =>
        current(events)?.messages.some(
          (item) =>
            (item.parts[0]?.type === 'text' ? item.parts[0].text : undefined) === 'resumed answer' &&
            item.metadata?.completeness === 'complete'
        )
      )
      .toBe(true)
    expect(faux.state.callCount).toBe(before + 1)
  })
})
