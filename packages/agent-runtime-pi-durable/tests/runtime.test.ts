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
import {
  configure,
  createRegistry,
  defineExtension,
  defineTool,
  MemoryStorage,
  StorageRequestError
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { describe, expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime, type PiDurableRuntimeOptions, type PiDurableThreadHandle } from '../src'

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
    const receipt = await first.input.submit(draft('question'))
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
    const settled = confirmed(await second.lookupInput({ by: 'native-ref', ref: receipt.nativeInput }))
    if (!settled.found) throw new Error('Missing input')
    const response = current(right)?.messages.find((item) => item.id === settled.input.response?.id)
    expect(response).toMatchObject({
      parts: [{ type: 'text', text: 'a sufficiently long streaming answer' }]
    })
    const archive = confirmed(await second.archive())
    const committed = archive.items.find((item) => item.ref.id === settled.input.response?.id)
    expect(committed).toEqual(response)
    const preview = right
      .flatMap((event) => (event.type === 'snapshot' ? event.items : []))
      .find((item) => item.type === 'message' && item.role === 'assistant' && item.completeness === 'partial')!
    expect(archive.aliases[committed!.ref.id]).toBe(preview.ref.id)
    expect(await first.input.submit(draft('released'))).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  })

  it('reads committed history across reset and pagination without scheduling a model', async () => {
    const { runtime, faux } = await setup()
    const access = confirmed(
      await runtime.create({
        ...sessionOptions,
        async init(tx, id) {
          for (let index = 0; index < 260; index++) {
            await tx.appendEntry(id, {
              kind: 'pi.user',
              model: [{ role: 'user', content: `message-${index}`, timestamp: index }]
            })
            if (index === 130) await tx.appendEntry(id, { kind: 'pi.reset', head: 'self' })
          }
        }
      })
    )
    const archive = confirmed(await access.archive())
    expect(
      archive.items.flatMap((item) => (item.type === 'message' ? item.parts.map((part) => part.text) : []))
    ).toEqual(Array.from({ length: 260 }, (_, index) => `message-${index}`))
    expect(faux.state.callCount).toBe(0)
    await access.release()
    expect(await access.archive()).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
    const reopened = confirmed(await runtime.open(access.thread))
    expect(confirmed(await reopened.archive()).items).toEqual(archive.items)
  })

  it.each(['before', 'after'] as const)(
    'keeps a steer submitted %s normal completion and answers it once',
    async (timing) => {
      const { runtime, faux } = await setup()
      const entered = gate()
      const finish = gate()
      onTestFinished(() => finish.resolve())
      faux.setResponses([
        async () => {
          entered.resolve()
          await finish.promise
          return fauxAssistantMessage('first')
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain('additional input')
          return fauxAssistantMessage('continued')
        }
      ])
      const handle = confirmed(await runtime.create(sessionOptions))
      await handle.input.submit({ ...draft('root'), deduplicationKey: 'root' })
      await entered.promise
      if (timing === 'after') {
        finish.resolve()
        await expect
          .poll(() => handle.lookupInput({ by: 'deduplication-key', key: 'root' }))
          .toMatchObject({
            status: 'confirmed',
            value: { found: true, input: { outcome: 'completed' } }
          })
      }
      const input = { ...draft('additional input', 'steer'), deduplicationKey: 'additional' }
      const receipt = await handle.input.submit(input)
      expect(receipt.status).toBe('acknowledged')
      finish.resolve()
      await expect
        .poll(() => handle.lookupInput({ by: 'deduplication-key', key: 'additional' }))
        .toMatchObject({
          status: 'confirmed',
          value: { found: true, input: { outcome: 'completed' } }
        })
      const root = confirmed(await handle.lookupInput({ by: 'deduplication-key', key: 'root' }))
      const additional = confirmed(await handle.lookupInput({ by: 'deduplication-key', key: 'additional' }))
      if (!root.found || !additional.found) throw new Error('Missing input receipt')
      expect(additional.input.response).not.toEqual(root.input.response)
      expect(
        confirmed(await handle.archive()).items.find((item) => item.ref.id === additional.input.response?.id)
      ).toMatchObject({ type: 'message', parts: [{ type: 'text', text: 'continued' }] })
      expect(await handle.input.submit(input)).toMatchObject({
        status: 'acknowledged',
        nativeInput: receipt.status === 'acknowledged' ? receipt.nativeInput : undefined
      })
      expect(
        confirmed(await handle.archive()).items.filter(
          (item) => item.type === 'message' && item.parts.some((part) => part.text === input.text)
        )
      ).toHaveLength(1)
      expect(faux.state.callCount).toBe(2)
    }
  )

  it('deduplicates queued input, rejects busy input without admission, and scopes withdrawal to its session', async () => {
    const { runtime, faux } = await setup()
    const hold = blocked()
    faux.setResponses([hold.step])
    const session = confirmed(await runtime.create(sessionOptions))
    const other = confirmed(await runtime.create(sessionOptions))
    await session.input.submit(draft('start'))
    await hold.reached
    expect(await session.input.submit({ ...draft('rejected'), deduplicationKey: 'rejected' })).toMatchObject({
      status: 'rejected',
      error: { code: 'busy' }
    })
    expect(confirmed(await session.lookupInput({ by: 'deduplication-key', key: 'rejected' }))).toEqual({ found: false })
    const input = { ...draft('queued', 'follow-up'), deduplicationKey: 'queue-key' }
    const first = await session.input.submit(input)
    const duplicate = await session.input.submit(input)
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
      input: { outcome: 'aborted' }
    })
    expect(await session.interrupt!()).toEqual({ status: 'confirmed', value: { effect: 'native-scope-idle' } })
  })

  it('preserves a truncated native answer without reporting successful input completion', async () => {
    const { runtime, faux } = await setup()
    faux.setResponses([fauxAssistantMessage('cut off', { stopReason: 'length' })])
    const handle = confirmed(await runtime.create(sessionOptions))
    const events = await observe(handle)
    const receipt = await handle.input.submit(draft('long answer'))
    if (receipt.status !== 'acknowledged' || !receipt.nativeInput) throw new Error('Missing receipt')
    await expect
      .poll(async () => confirmed(await handle.lookupInput({ by: 'native-ref', ref: receipt.nativeInput! })))
      .toMatchObject({
        found: true,
        input: { outcome: 'unanswered', response: { session: handle.thread }, error: { code: 'output-truncated' } }
      })
    expect(
      events.filter((event) => event.type === 'input.changed').some((event) => event.input.outcome === 'completed')
    ).toBe(false)
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
    const result = await session.input.submit(draft('admitted before read failure'))
    expect(result).toMatchObject({
      status: 'acknowledged',
      nativeInput: { session: session.thread },
      facts: expect.arrayContaining(['accepted'])
    })
  })

  it('retains input correlation through a recoverable status read failure and eventual completion', async () => {
    class UnavailableStatusStorage extends MemoryStorage {
      private unavailable = true

      override async submission(...args: Parameters<MemoryStorage['submission']>) {
        if (this.unavailable) {
          this.unavailable = false
          throw new StorageRequestError('status read unavailable')
        }
        return super.submission(...args)
      }
    }
    const { runtime, faux } = await setup(async () => new UnavailableStatusStorage())
    const finish = gate()
    onTestFinished(() => finish.resolve())
    faux.setResponses([
      async () => {
        await finish.promise
        return fauxAssistantMessage('answer')
      }
    ])
    const handle = confirmed(await runtime.create(sessionOptions))
    const events = await observe(handle)
    expect(await handle.input.submit(draft('recoverable'))).toMatchObject({ status: 'acknowledged' })
    const latest = () => events.filter((event) => event.type === 'input.changed').at(-1)?.input
    await expect.poll(latest).toMatchObject({ inputId: 'recoverable', facts: expect.arrayContaining(['accepted']) })
    expect(latest()?.outcome).toBeUndefined()
    finish.resolve()
    await expect.poll(latest).toMatchObject({
      inputId: 'recoverable',
      outcome: 'completed',
      response: { session: handle.thread }
    })
  })

  it('shares a native final answer across the original input and steering after a tool', async () => {
    const { runtime, faux, registry } = await setup()
    const executing = gate()
    const finish = gate()
    onTestFinished(() => finish.resolve())
    registry.install(
      defineExtension({
        name: 'hold',
        tools: [
          defineTool({
            name: 'hold',
            description: 'Hold the tool boundary',
            parameters: Type.Object({}),
            async execute() {
              executing.resolve()
              await finish.promise
              return { output: [{ type: 'text', text: 'tool finished' }] }
            }
          })
        ]
      })
    )
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('hold', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('answer using both inputs')
    ])
    const handle = confirmed(await runtime.create(sessionOptions))
    const events = await observe(handle)
    const first = await handle.input.submit({ ...draft('root'), deduplicationKey: 'root' })
    if (first.status !== 'acknowledged' || !first.nativeInput) throw new Error('Missing input reference')
    await executing.promise
    await handle.input.submit({
      ...draft('steering', 'steer'),
      deduplicationKey: 'steering'
    })
    finish.resolve()
    const lookup = async (key: string) => {
      const result = confirmed(await handle.lookupInput({ by: 'deduplication-key', key }))
      if (!result.found) throw new Error('Missing input')
      return result.input
    }
    await expect.poll(() => lookup('steering')).toMatchObject({ outcome: 'completed' })
    const root = await lookup('root')
    const steering = await lookup('steering')
    expect(root).toMatchObject({ outcome: 'completed', response: steering.response })
    expect(current(events)?.messages.find((item) => item.id === root.response?.id)).toMatchObject({
      parts: [{ type: 'text', text: 'answer using both inputs' }]
    })
  })

  it('discovers native forks and archives only child-owned output independently of the parent', async () => {
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
                const head = (await tx.scanEntries({ conversationId: api.conversationId }, 1)).items[0]
                const record = await tx.forkConversation(api.conversationId, head.id, {
                  ownership: { kind: 'task', taskId: api.taskId }
                })
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
    await parent.input.submit(draft('delegate now'))
    await expect.poll(() => parentEvents.some((event) => event.type === 'subagent.upsert')).toBe(true)
    const relationship = parentEvents.find((event) => event.type === 'subagent.upsert')
    if (relationship?.type !== 'subagent.upsert') throw new Error('No child reference')
    const child = confirmed(await runtime.open(relationship.subagent.child!))
    const events = await observe(child)
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
    const archived = confirmed(await child.archive()).items
    expect(archived.some((item) => item.type === 'message' && item.parts[0]?.text === 'delegate now')).toBe(false)
    expect(archived.some((item) => item.type === 'tool-call' && item.name === 'delegate')).toBe(false)
    expect(archived.some((item) => item.type === 'message' && item.parts[0]?.text === 'independent child output')).toBe(
      true
    )
    await expect
      .poll(() =>
        current(parentEvents)?.messages.some(
          (item) =>
            item.parts.find((part) => part.type === 'text')?.text === 'parent finished' &&
            item.metadata?.completeness === 'complete'
        )
      )
      .toBe(true)
    const parentItems = current(parentEvents)!.messages
    await parent.release()
    const started = gate()
    const finish = gate()
    onTestFinished(() => finish.resolve())
    faux.setResponses([
      async () => {
        started.resolve()
        await finish.promise
        return fauxAssistantMessage('child interim')
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain('extra detail')
        return fauxAssistantMessage('continued child output')
      }
    ])
    const continued = await child.input.submit(draft('continue child'))
    expect(continued).toMatchObject({ status: 'acknowledged' })
    await started.promise
    expect(await child.input.submit(draft('reject busy'))).toMatchObject({
      status: 'rejected',
      error: { code: 'busy' }
    })
    expect(await child.input.submit(draft('extra detail', 'steer'))).toMatchObject({ status: 'acknowledged' })
    const retained = confirmed(await runtime.open(child.thread))
    const retainedEvents = await observe(retained)
    await child.release()
    finish.resolve()
    await expect
      .poll(() =>
        current(retainedEvents)?.messages.some(
          (item) =>
            item.parts.find((part) => part.type === 'text')?.text === 'continued child output' &&
            item.metadata?.completeness === 'complete'
        )
      )
      .toBe(true)
    if (continued.status !== 'acknowledged' || !continued.nativeInput) throw new Error('Missing receipt')
    await expect
      .poll(async () => confirmed(await retained.lookupInput({ by: 'native-ref', ref: continued.nativeInput! })))
      .toMatchObject({ found: true, input: { outcome: 'completed' } })
    const reopenedParent = confirmed(await runtime.open(parent.thread))
    const restored = await observe(reopenedParent)
    await expect.poll(() => current(restored)).toMatchObject({ subagents: [relationship.subagent] })
    expect(current(restored)!.subagents).toHaveLength(1)
    expect(current(restored)!.messages).toEqual(parentItems)
  })

  it('closes without cancelling durable work, reopens for observation only, then resumes explicitly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'durable-runtime-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const { runtime, faux, options } = await setup(() => openNodeSqliteStorage(join(directory, 'session.sqlite')))
    const hold = blocked()
    faux.setResponses([hold.step])
    const session = confirmed(await runtime.create(sessionOptions))
    const receipt = await session.input.submit({ ...draft('survive restart'), deduplicationKey: 'restart-key' })
    await hold.reached
    expect(receipt.status).toBe('acknowledged')
    expect(await runtime.shutdown()).toEqual({ status: 'confirmed', value: { effect: 'closed' } })
    expect(await session.input.submit(draft('too late'))).toMatchObject({
      status: 'rejected',
      error: { code: 'closed' }
    })

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
    const archive = confirmed(await access.archive())
    await reopened.shutdown()
    const restored = confirmed(await createPiDurableRuntime(options))
    onTestFinished(async () => {
      await restored.shutdown()
    })
    const restoredAccess = confirmed(await restored.open(session.thread))
    expect(confirmed(await restoredAccess.archive())).toEqual({ items: archive.items, aliases: {} })
    expect(faux.state.callCount).toBe(before + 1)
  })
})
