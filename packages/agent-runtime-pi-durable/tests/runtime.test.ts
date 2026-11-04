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

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import {
  createPiDurableRuntime,
  type DurableObservation,
  type PiDurableRuntimeOptions,
  type PiDurableThreadHandle
} from '../src'

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
  return { runtime, faux, options, errors, registry, models }
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
  it('pairs final content, input failure and foreground completion at one native revision for a delayed observer', async () => {
    const { runtime, faux } = await setup()
    const provider = gate()
    const consumer = gate()
    onTestFinished(() => {
      provider.resolve()
      consumer.resolve()
    })
    faux.setResponses([
      async () => {
        await provider.promise
        return fauxAssistantMessage('truncated body', { stopReason: 'length' })
      }
    ])
    const handle = confirmed(await runtime.create(sessionOptions))
    const fast: DurableObservation[] = []
    const slow: DurableObservation[] = []
    confirmed(
      await handle.durable.observe((batch) => {
        fast.push(batch)
      })
    )
    const observation = confirmed(
      await handle.durable.observe(async (batch) => {
        slow.push(batch)
        if (slow.length === 1) await consumer.promise
      })
    )
    await handle.input.submit(draft('atomic'))
    await expect
      .poll(() =>
        fast.some((batch) =>
          batch.events.some((event) => event.type === 'snapshot' && event.activity.state === 'active')
        )
      )
      .toBe(true)
    expect(fast.some((batch) => batch.completion)).toBe(false)
    provider.resolve()
    await expect.poll(() => fast.some((batch) => batch.completion)).toBe(true)
    expect(slow).toHaveLength(1)
    const final = fast.find((batch) => batch.completion)!
    expect(final.completion).toMatchObject({
      inputs: [{ inputId: 'atomic', outcome: 'unanswered', error: { code: 'output-truncated' } }]
    })
    expect(final.events).toMatchObject([
      { type: 'snapshot', inputs: expect.arrayContaining([{ ...final.completion!.inputs[0] }]) }
    ])
    const body = final.events.flatMap((event) => (event.type === 'snapshot' ? event.messages : []))
    expect(body.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({ type: 'text', text: 'truncated body' })
    )
    consumer.resolve()
    await observation.drain()
    expect(slow.filter((batch) => batch.completion)).toEqual([final])
    const late: DurableObservation[] = []
    const attached = confirmed(
      await handle.durable.observe((batch) => {
        late.push(batch)
      })
    )
    await attached.drain()
    expect(late[0]).toMatchObject({ live: [], completion: undefined })
  })

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
            item.parts.find((part) => part.type === 'text')?.text === 'a sufficiently long streaming answer'
        )
      )
      .toBe(true)
    expect(left).toHaveLength(releasedCount)
    expect(current(right)?.messages.filter((item) => item.role === 'assistant')).toHaveLength(1)
    if (receipt.status !== 'acknowledged' || !receipt.nativeInput) throw new Error('No native receipt')
    await expect
      .poll(() => current(right)?.inputs.find((input) => input.nativeInput?.id === receipt.nativeInput!.id))
      .toMatchObject({ inputId: 'question', outcome: 'completed' })
    const response = current(right)?.messages.find((item) => item.role === 'assistant')
    expect(response).toMatchObject({ parts: [{ type: 'text', text: 'a sufficiently long streaming answer' }] })
    const archive = confirmed(await second.archive())
    const committed = archive.messages.find((item) => item.id === response?.id)
    expect(committed).toEqual(response)
    const preview = right
      .flatMap((event) => (event.type === 'snapshot' ? event.messages : []))
      .find((item) => item.role === 'assistant' && item.metadata?.completeness === 'partial')!
    expect(archive.aliases[committed!.id]).toBe(preview.id)
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
      archive.messages.flatMap((item) =>
        item.parts.flatMap((part) => (part.type === 'text' || part.type === 'reasoning' ? [part.text] : []))
      )
    ).toEqual(Array.from({ length: 260 }, (_, index) => `message-${index}`))
    expect(faux.state.callCount).toBe(0)
    await access.release()
    expect(await access.archive()).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
    const reopened = confirmed(await runtime.open(access.thread))
    expect(confirmed(await reopened.archive()).messages).toEqual(archive.messages)
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
      const events = await observe(handle)
      await handle.input.submit(draft('root'))
      await entered.promise
      if (timing === 'after') {
        finish.resolve()
        await expect
          .poll(() => current(events)?.inputs.find((input) => input.inputId === 'root')?.outcome)
          .toBe('completed')
      }
      const input = draft('additional input', 'steer')
      const receipt = await handle.input.submit(input)
      expect(receipt.status).toBe('acknowledged')
      finish.resolve()
      await expect
        .poll(() => current(events)?.inputs.find((state) => state.inputId === input.inputId)?.outcome)
        .toBe('completed')
      expect(current(events)?.inputs.find((state) => state.inputId === 'root')?.outcome).toBe('completed')
      expect(
        confirmed(await handle.archive())
          .messages.filter((item) => item.role === 'assistant')
          .flatMap((item) => item.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      ).toEqual(['first', 'continued'])
      expect(
        confirmed(await handle.archive()).messages.filter((item) =>
          item.parts.some((part) => 'text' in part && part.text === input.text)
        )
      ).toHaveLength(1)
      expect(faux.state.callCount).toBe(2)
    }
  )

  it('rejects busy input without admission and withdraws queued input on interrupt', async () => {
    const { runtime, faux } = await setup()
    const hold = blocked()
    faux.setResponses([hold.step])
    const session = confirmed(await runtime.create(sessionOptions))
    const events = await observe(session)
    await session.input.submit(draft('start'))
    await hold.reached
    expect(await session.input.submit(draft('rejected'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
    expect(current(events)?.inputs.some((input) => input.inputId === 'rejected')).toBe(false)
    const queued = await session.input.submit(draft('queued', 'follow-up'))
    expect(queued).toMatchObject({ status: 'acknowledged', facts: ['accepted', 'queued'] })
    expect(await session.interrupt!()).toEqual({ status: 'confirmed', value: undefined })
    await expect
      .poll(() => current(events)?.inputs.find((input) => input.inputId === 'queued')?.outcome)
      .toBe('aborted')
    expect(faux.state.callCount).toBe(1)
  })

  it('preserves a truncated native answer without reporting successful input completion', async () => {
    const { runtime, faux } = await setup()
    faux.setResponses([fauxAssistantMessage('cut off', { stopReason: 'length' })])
    const handle = confirmed(await runtime.create(sessionOptions))
    const events = await observe(handle)
    const receipt = await handle.input.submit(draft('long answer'))
    if (receipt.status !== 'acknowledged' || !receipt.nativeInput) throw new Error('Missing receipt')
    await expect
      .poll(() => current(events)?.inputs.find((input) => input.nativeInput?.id === receipt.nativeInput!.id))
      .toMatchObject({ outcome: 'unanswered', error: { code: 'output-truncated' } })
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
      outcome: 'completed'
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
    const first = await handle.input.submit(draft('root'))
    if (first.status !== 'acknowledged' || !first.nativeInput) throw new Error('Missing input reference')
    await executing.promise
    await handle.input.submit(draft('steering', 'steer'))
    finish.resolve()
    await expect
      .poll(() => current(events)?.inputs.find((input) => input.inputId === 'steering')?.outcome)
      .toBe('completed')
    expect(current(events)?.inputs.find((input) => input.inputId === 'root')?.outcome).toBe('completed')
    expect(
      current(events)
        ?.messages.filter((item) => item.role === 'assistant')
        .flatMap((item) => item.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
    ).toEqual(['answer using both inputs'])
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
    expect(relationship.subagent.origin).toEqual({ toolCallId: 'delegation-call' })
    const access = confirmed(await parent.durable.openChild('delegation-call'))
    expect(access.relation).toEqual(relationship.subagent)
    const child = access.handle
    const events = await observe(child)
    await expect
      .poll(
        () =>
          current(events)?.messages.some(
            (item) =>
              item.parts.find((part) => part.type === 'text')?.text === 'independent child output' &&
              item.metadata?.completeness === 'complete'
          ),
        { timeout: 5000 }
      )
      .toBe(true)
    expect(child.thread).not.toEqual(parent.thread)
    const archived = confirmed(await child.archive()).messages
    expect(archived.some((item) => item.parts.find((part) => part.type === 'text')?.text === 'delegate now')).toBe(
      false
    )
    expect(
      archived.some((message) =>
        message.parts.some((part) => part.type === 'dynamic-tool' && part.toolName === 'delegate')
      )
    ).toBe(false)
    expect(
      archived.some((item) => item.parts.find((part) => part.type === 'text')?.text === 'independent child output')
    ).toBe(true)
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
      .poll(() => current(retainedEvents)?.inputs.find((input) => input.nativeInput?.id === continued.nativeInput!.id))
      .toMatchObject({ outcome: 'completed' })
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
    const receipt = await session.input.submit(draft('survive restart'))
    await hold.reached
    expect(receipt.status).toBe('acknowledged')
    expect(await runtime.shutdown()).toEqual({ status: 'confirmed', value: undefined })
    expect(await session.input.submit(draft('too late'))).toMatchObject({
      status: 'rejected',
      error: { code: 'closed' }
    })

    faux.setResponses([{ ...fauxAssistantMessage('resumed answer'), responseId: 'native-resumed-response' }])
    const reopened = confirmed(await createPiDurableRuntime(options))
    onTestFinished(async () => {
      await reopened.shutdown()
    })
    const [a, b] = await Promise.all([reopened.open(session.thread), reopened.open(session.thread)])
    const access = confirmed(a)
    const events = await observe(confirmed(b))
    const before = faux.state.callCount
    await expect
      .poll(() => current(events)?.inputs.find((input) => input.inputId === 'survive restart'))
      .toMatchObject({ facts: ['accepted', 'placed'] })
    expect(current(events)?.inputs.find((input) => input.inputId === 'survive restart')?.outcome).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(faux.state.callCount).toBe(before)
    expect(await reopened.resume()).toEqual({
      status: 'confirmed',
      value: undefined
    })
    await expect
      .poll(() =>
        current(events)?.messages.some(
          (item) =>
            item.parts.find((part) => part.type === 'text')?.text === 'resumed answer' &&
            item.metadata?.completeness === 'complete'
        )
      )
      .toBe(true)
    expect(faux.state.callCount).toBe(before + 1)
    const archive = confirmed(await access.archive())
    const owner = archive.messages.find((message) => message.id === archive.responseIds?.['native-resumed-response'])
    expect(owner?.parts).toContainEqual({ type: 'text', text: 'resumed answer', state: 'done' })
    await reopened.shutdown()
    const restored = confirmed(await createPiDurableRuntime(options))
    onTestFinished(async () => {
      await restored.shutdown()
    })
    const restoredAccess = confirmed(await restored.open(session.thread))
    expect(confirmed(await restoredAccess.archive())).toEqual({
      messages: archive.messages,
      responseIds: archive.responseIds,
      legacy: archive.legacy,
      aliases: {}
    })
    expect(faux.state.callCount).toBe(before + 1)
  })
})

it('reads the native compaction estimate passively without resuming the scheduler or writing usage', async () => {
  const { runtime, models } = await setup()
  const access = confirmed(await runtime.create(sessionOptions))
  const events = await observe(access)
  const before = confirmed(await access.contextUsage())
  expect(before).toMatchObject({
    model: 'faux-1',
    basis: 'current-context',
    used: { tokens: 0, precision: 'estimated' }
  })
  expect(before.contextWindow).toBe(models.getModel('faux', 'faux-1')!.contextWindow)
  const archive = confirmed(await access.archive())
  expect(confirmed(await access.contextUsage())).toEqual(before)
  expect(confirmed(await access.archive())).toEqual(archive)
  expect(events.filter((event) => event.type === 'input.changed')).toEqual([])
  expect(events.filter((event) => event.type === 'snapshot').every((event) => event.activity.state === 'idle')).toBe(
    true
  )
  await access.release()
  expect(await access.contextUsage()).toMatchObject({ status: 'rejected', error: { code: 'released' } })
})

it('reads context from the current factory-backed model registry', async () => {
  let models = createModels()
  models.setProvider(fauxProvider({ models: [{ id: 'faux-1', contextWindow: 128_000 }] }).provider)
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('factory-context'),
      openStorage: async () => new MemoryStorage(),
      harness: { models: () => models, registry: createRegistry() }
    })
  )
  try {
    const handle = confirmed(await runtime.create(sessionOptions))
    expect(confirmed(await handle.contextUsage()).contextWindow).toBe(128_000)
    models = createModels()
    models.setProvider(fauxProvider({ models: [{ id: 'faux-1', contextWindow: 64_000 }] }).provider)
    expect(confirmed(await handle.contextUsage()).contextWindow).toBe(64_000)
    expect(confirmed(await handle.archive()).messages).toEqual([])
  } finally {
    await runtime.shutdown()
  }
})

it('measures committed prompt sources and codemode-only tools without executing them', async () => {
  const { runtime, faux, registry } = await setup()
  let memory = 'Memory snapshot'
  registry.install(
    defineExtension({
      name: 'context-detail',
      sections: [
        {
          key: 'identity',
          render: () => ({
            text: memory,
            source: {
              kind: 'memory-files',
              resources: [{ id: 'SOUL.md', name: 'SOUL.md', source: '/agent/SOUL.md', characters: memory.length }]
            }
          })
        },
        { key: 'skills', render: () => ({ text: 'Only the skill summary', source: { kind: 'skills' } }) }
      ],
      tools: [
        defineTool({
          name: 'external_lookup',
          description: 'Only callable from codemode',
          contextSource: { kind: 'mcp-tools', source: 'server' },
          callers: ['tools'],
          parameters: Type.Object({}),
          execute: async () => {
            throw new Error('Measurement must not execute tools')
          }
        })
      ]
    })
  )
  faux.setResponses([fauxAssistantMessage('ready')])
  const handle = confirmed(await runtime.create(sessionOptions))
  const events = await observe(handle)
  await handle.input.submit(draft('measure prepared context'))
  await expect
    .poll(() =>
      current(events)?.messages.some(
        (message) => message.role === 'assistant' && message.metadata?.completeness === 'complete'
      )
    )
    .toBe(true)
  await expect.poll(() => current(events)?.activity.state).toBe('idle')
  const before = confirmed(await handle.contextUsage())
  expect(before.resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'SOUL.md',
        category: 'memory-files',
        source: '/agent/SOUL.md',
        count: { tokens: 5, precision: 'estimated' }
      }),
      expect.objectContaining({ name: 'external_lookup', category: 'mcp-tools', source: 'server', state: 'deferred' })
    ])
  )
  expect(before.breakdown?.categories.some((row) => row.key === 'mcp-tools' && row.occupancy === 'included')).toBe(
    false
  )
  memory = 'Uncommitted new memory '.repeat(100)
  expect(confirmed(await handle.contextUsage())).toEqual(before)
})

// Catches eagerly capturing a registry factory or dropping request metering when native models are refreshed.
it('resolves a fresh model registry for each request with shared behavior enabled', async () => {
  const first = fauxProvider()
  first.setResponses([fauxAssistantMessage('first registry')])
  const second = fauxProvider()
  second.setResponses([fauxAssistantMessage('replacement registry')])
  let models = createModels()
  models.setProvider(first.provider)
  const host = createScriptedHost({
    settings: {
      goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
      autonomy: 'auto',
      permissionMode: 'default',
      attendance: 'stream',
      maxBackground: 2,
      offloadThreshold: 4000
    }
  })
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('dynamic-models'),
      openStorage: async () => new MemoryStorage(),
      harness: { models: () => models, registry: createRegistry() },
      behavior: { host, configureChild: () => ({ model: sessionOptions.agent.model }) }
    })
  )
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  const access = confirmed(await runtime.create(sessionOptions))
  const events = await observe(access)
  confirmed(await runtime.resume())
  await access.input.submit(draft('first request'))
  await expect
    .poll(() =>
      current(events)?.messages.some(
        (message) =>
          message.parts.some((part) => part.type === 'text' && part.text === 'first registry') &&
          message.metadata?.completeness === 'complete'
      )
    )
    .toBe(true)
  models = createModels()
  models.setProvider(second.provider)
  await access.input.submit(draft('second request', 'follow-up'))
  await expect
    .poll(() =>
      current(events)?.messages.some(
        (message) =>
          message.parts.some((part) => part.type === 'text' && part.text === 'replacement registry') &&
          message.metadata?.completeness === 'complete'
      )
    )
    .toBe(true)
  expect(first.state.callCount).toBe(1)
  expect(second.state.callCount).toBe(1)
})
