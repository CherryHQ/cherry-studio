import type { Context } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from '@earendil-works/pi-ai'
import {
  createRegistry,
  defineExtension,
  defineTask,
  defineTool,
  MemoryStorage,
  StorageRequestError,
  type ConversationRecord,
  type EntryRecord,
  type Storage,
  type ToolExecutionApi
} from '@earendil-works/pi-durable'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime, type PiDurableThreadHandle } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  onTestFinished(resolve)
  return { promise, resolve }
}

async function setup(
  execute: (api: ToolExecutionApi, context: Context) => Promise<void>,
  storage: Storage = new MemoryStorage()
) {
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  registry.install(
    defineExtension({
      name: 'delegate',
      tools: [
        defineTool({
          name: 'delegate',
          description: 'Create children',
          parameters: Type.Object({}),
          async execute(_args, api, context) {
            await execute(api, context)
            return { output: [{ type: 'text', text: 'created' }] }
          }
        })
      ]
    })
  )
  const errors: unknown[] = []
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('relations'),
      openStorage: async () => storage,
      harness: { models, registry, onReport: (error) => errors.push(error) },
      onError: (error) => errors.push(error)
    })
  )
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('delegate', {}, { id: 'spawn' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('parent finished')
  ])
  return { runtime, faux, registry, errors }
}

async function parent(runtime: Awaited<ReturnType<typeof setup>>['runtime']) {
  return confirmed(
    await runtime.create({
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
  )
}

async function observe(handle: PiDurableThreadHandle) {
  const events: ObservationPayload[] = []
  const observation = confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  await observation.drain()
  return { events, observation }
}

async function submit(handle: PiDurableThreadHandle) {
  const result = await handle.input.submit({ inputId: runtimeId('input'), text: 'delegate', whenBusy: 'reject' })
  expect(result.status).toBe('acknowledged')
}

const owner = defineTask<null, { phase: 'run' }, null>({
  name: 'relation-owner',
  version: 1,
  initial: () => ({ phase: 'run' }),
  phases: {
    async run(_task, api, context) {
      await api.commit(async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), context)
    }
  },
  async abort(_task, api, context) {
    await api.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), context)
  }
})

it('loads all pages of immediate native ownership without importing siblings or fork ancestry', async () => {
  const { runtime, registry, faux, errors } = await setup(async () => {})
  registry.install(defineExtension({ name: 'owners', tasks: [owner] }))
  const children: ConversationRecord[] = []
  let head: EntryRecord | undefined
  const created = await runtime.create({
    ownership: { kind: 'ownerless' },
    async init(tx, id) {
      const taskId = await tx.createTask(owner, null, { conversationId: id, ownership: { kind: 'conversation' } })
      for (let index = 0; index < 260; index++)
        children.push(await tx.createConversation({ ownership: { kind: 'task', taskId } }))
      const nestedOwner = await tx.createTask(owner, null, {
        conversationId: children[0].id,
        ownership: { kind: 'conversation' }
      })
      await tx.createConversation({ ownership: { kind: 'task', taskId: nestedOwner } })
      head = await tx.appendEntry(id, {
        kind: 'pi.user',
        model: [{ role: 'user', content: 'ancestor', timestamp: 0 }]
      })
      await tx.createConversation({ ownership: { kind: 'ownerless' } })
    }
  })
  expect(errors).toEqual([])
  const root = confirmed(created)
  const fork = head
  if (!fork) throw new Error('Missing fork point')
  confirmed(
    await runtime.create({
      ownership: { kind: 'ownerless' },
      async init(tx) {
        await tx.forkConversation(fork.conversationId, fork.id, { ownership: { kind: 'ownerless' } })
      }
    })
  )
  const { events } = await observe(root)
  const snapshot = events[0]
  expect(snapshot.type).toBe('snapshot')
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  expect(snapshot.subagents?.map((child) => child.child?.id)).toEqual(children.map((child) => String(child.id)))
  const nested = confirmed(await runtime.open({ ...root.thread, id: runtimeId(String(children[0].id)) }))
  const nestedEvents = await observe(nested)
  expect(nestedEvents.events[0]).toMatchObject({
    subagents: [expect.objectContaining({ parent: nested.thread })]
  })
  expect(faux.state.callCount).toBe(0)
})

it('gives concurrent opens independent cancellation and reports unknown or completed childless calls', async () => {
  const entered = gate()
  const create = gate()
  let createsChild = true
  const { runtime, faux } = await setup(async (api, context) => {
    entered.resolve()
    await create.promise
    if (createsChild)
      await api.commit((tx) => tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }), context)
  })
  const root = await parent(runtime)
  await submit(root)
  await entered.promise
  const abort = new AbortController()
  const cancelled = root.durable.openChild('spawn', abort.signal)
  const left = root.durable.openChild('spawn')
  const right = root.durable.openChild('spawn')
  abort.abort()
  expect(await cancelled).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  expect(await root.durable.openChild('unknown')).toMatchObject({ status: 'rejected', error: { code: 'unknown-call' } })
  create.resolve()
  const a = confirmed(await left)
  const b = confirmed(await right)
  expect(a.handle.thread).toEqual(b.handle.thread)
  await a.handle.release()
  expect(await b.handle.durable.relation()).toEqual(b.relation)
  expect(await b.handle.archive()).toMatchObject({ status: 'confirmed' })
  await runtime.settled()
  createsChild = false
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('delegate', {}, { id: 'spawn' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('parent finished')
  ])
  const other = await parent(runtime)
  await submit(other)
  await runtime.settled()
  expect(await other.durable.openChild('spawn')).toMatchObject({
    status: 'rejected',
    error: { code: 'child-unavailable' }
  })
})

it('rejects ambiguous creation origins and retries a failed relation read without resubmitting', async () => {
  const storage = new MemoryStorage()
  let fail = false
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === 'task')
        return async (...args: Parameters<Storage['task']>) => {
          if (fail) {
            fail = false
            throw new StorageRequestError('relation temporarily unavailable')
          }
          return target.task(...args)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const children: ConversationRecord[] = []
  const { runtime, faux } = await setup(async (api, context) => {
    await api.commit(async (tx) => {
      for (let index = 0; index < 2; index++)
        children.push(await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }))
    }, context)
  }, wrapped)
  const root = await parent(runtime)
  await submit(root)
  await runtime.settled()
  expect(await root.durable.openChild('spawn')).toMatchObject({
    status: 'rejected',
    error: { code: 'ambiguous-origin' }
  })
  const child = confirmed(await runtime.open({ ...root.thread, id: runtimeId(String(children[0].id)) }))
  await runtime.settled()
  const calls = faux.state.callCount
  fail = true
  await expect(child.durable.relation()).rejects.toThrow('relation temporarily unavailable')
  expect(await child.durable.relation()).toMatchObject({ parent: root.thread, origin: { toolCallId: 'spawn' } })
  expect(faux.state.callCount).toBe(calls)
})

it('covers creation queued during the first parent scan and permits retry after a failed scan', async () => {
  const ready = gate()
  const scanning = gate()
  const finishScan = gate()
  const createChild = gate()
  const children: ConversationRecord[] = []
  let record: ConversationRecord | undefined
  let scanned = false
  let fail = true
  const storage = new MemoryStorage()
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === 'scanConversations')
        return async (...args: Parameters<Storage['scanConversations']>) => {
          if (record && args[0].ownerConversationId === record.id) {
            if (fail) {
              fail = false
              throw new StorageRequestError('initial scan unavailable')
            }
            if (!scanned) {
              scanned = true
              const page = await target.scanConversations(...args)
              scanning.resolve()
              await finishScan.promise
              return page
            }
          }
          return target.scanConversations(...args)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const { runtime, registry } = await setup(async (api, context) => {
    const target = await api.commit(async (tx) => {
      const created = await tx.createConversation({ ownership: { kind: 'ownerless' } })
      const taskId = await tx.createTask(owner, null, {
        conversationId: created.id,
        ownership: { kind: 'conversation' }
      })
      children.push(await tx.createConversation({ ownership: { kind: 'task', taskId } }))
      return created
    }, context)
    record = target
    ready.resolve()
    await createChild.promise
    await api.commit(async (tx) => {
      const taskId = await tx.createTask(owner, null, {
        conversationId: target.id,
        ownership: { kind: 'conversation' }
      })
      children.push(await tx.createConversation({ ownership: { kind: 'task', taskId } }))
    }, context)
  }, wrapped)
  registry.install(defineExtension({ name: 'owners', tasks: [owner] }))
  const controller = await parent(runtime)
  await submit(controller)
  await ready.promise
  if (!record) throw new Error('Missing native parent')
  const thread = { ...controller.thread, id: runtimeId<'thread'>(String(record.id)) }
  expect(await runtime.open(thread)).toMatchObject({ status: 'unknown', error: { code: 'native-error' } })
  const opening = runtime.open(thread)
  await scanning.promise
  createChild.resolve()
  finishScan.resolve()
  const opened = confirmed(await opening)
  await runtime.settled()
  const { events } = await observe(opened)
  expect(events[0]).toMatchObject({
    subagents: children.map((child) => ({ id: String(child.id), parent: thread }))
  })
})

it('does not repeat child lookups for unrelated text revisions while creation is pending', async () => {
  const entered = gate()
  const write = gate()
  const written = gate()
  const create = gate()
  const storage = new MemoryStorage()
  let parentId = ''
  let lookups = 0
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === 'scanConversations')
        return async (...args: Parameters<Storage['scanConversations']>) => {
          if (String(args[0].ownerConversationId) === parentId) lookups++
          return target.scanConversations(...args)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const { runtime } = await setup(async (api, context) => {
    entered.resolve()
    await write.promise
    for (let index = 0; index < 20; index++)
      await api.commit(
        (tx) =>
          tx.appendEntry(api.conversationId, {
            kind: 'pi.user',
            model: [{ role: 'user', content: `note ${index}`, timestamp: index }]
          }),
        context
      )
    written.resolve()
    await create.promise
    await api.commit((tx) => tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }), context)
  }, wrapped)
  const root = await parent(runtime)
  parentId = root.thread.id
  await submit(root)
  await entered.promise
  const opening = root.durable.openChild('spawn')
  await expect.poll(() => lookups).toBe(1)
  write.resolve()
  await written.promise
  create.resolve()
  const child = confirmed(await opening)
  expect(child.relation.origin?.toolCallId).toBe('spawn')
  expect(lookups).toBe(2)
})

it('settles a pending child open when its access is released without cancelling another access', async () => {
  const entered = gate()
  const create = gate()
  const { runtime } = await setup(async (api, context) => {
    entered.resolve()
    await create.promise
    await api.commit((tx) => tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }), context)
  })
  const root = await parent(runtime)
  const other = confirmed(await runtime.open(root.thread))
  await submit(root)
  await entered.promise
  const released = root.durable.openChild('spawn')
  const retained = other.durable.openChild('spawn')
  await root.release()
  expect(await released).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  create.resolve()
  expect(confirmed(await retained).relation.parent).toEqual(other.thread)
})

it('closes observations when the native session fails without a task graph watch', async () => {
  const storage = new MemoryStorage()
  let fail = false
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === 'task')
        return async (...args: Parameters<Storage['task']>) => {
          if (fail) throw new Error('native storage failed')
          return target.task(...args)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const { runtime, errors } = await setup(async (api, context) => {
    await api.commit((tx) => tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }), context)
  }, wrapped)
  const root = await parent(runtime)
  const { events } = await observe(root)
  await submit(root)
  await runtime.settled()
  const child = confirmed(await root.durable.openChild('spawn')).handle
  await runtime.settled()
  fail = true
  await expect(child.durable.relation()).rejects.toThrow()
  await expect.poll(() => events.at(-1)).toEqual({ type: 'closed', reason: 'source-lost' })
  expect(errors.some((error) => error instanceof Error && error.message === 'native storage failed')).toBe(true)
})

it('settles pending child access when the runtime closes', async () => {
  const entered = gate()
  const finish = gate()
  const { runtime } = await setup(async () => {
    entered.resolve()
    await finish.promise
  })
  const root = await parent(runtime)
  await submit(root)
  await entered.promise
  const opening = root.durable.openChild('spawn')
  const closing = runtime.shutdown()
  expect(await opening).toMatchObject({ status: 'rejected', error: { code: 'closed' } })
  finish.resolve()
  expect(await closing).toMatchObject({ status: 'confirmed' })
})

it.each(['settled', 'shutdown'] as const)('joins admitted relation delivery before %s completes', async (operation) => {
  const reading = gate()
  const deliver = gate()
  const storage = new MemoryStorage()
  let held: ConversationRecord['owner']
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === 'commit')
        return async (...args: Parameters<Storage['commit']>) => {
          const seq = await target.commit(...args)
          const child = args[0].find((write) => write.type === 'conversation' && write.value.owner)
          if (child?.type === 'conversation') held = child.value.owner
          return seq
        }
      if (key === 'task')
        return async (...args: Parameters<Storage['task']>) => {
          const task = await target.task(...args)
          if (held?.taskId === args[0]) {
            held = undefined
            reading.resolve()
            await deliver.promise
          }
          return task
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const { runtime, errors } = await setup(async (api, context) => {
    await api.commit((tx) => tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } }), context)
  }, wrapped)
  const root = await parent(runtime)
  const { events, observation } = await observe(root)
  await submit(root)
  await reading.promise
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.type === 'snapshot' &&
          event.messages.some((message) =>
            message.parts.some((part) => part.type === 'text' && part.text === 'parent finished')
          )
      )
    )
    .toBe(true)
  expect(events.some((event) => event.type === 'subagent.upsert')).toBe(false)
  const opened = confirmed(await root.durable.openChild('spawn'))
  expect(opened.relation.origin).toEqual({ toolCallId: 'spawn' })
  let ended = false
  const ending = runtime[operation]().then(() => {
    ended = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(ended).toBe(false)
  deliver.resolve()
  await ending
  await observation.drain()
  const relation = events.findIndex((event) => event.type === 'subagent.upsert')
  expect(relation).toBeGreaterThan(-1)
  if (operation === 'shutdown') {
    expect(events.findIndex((event) => event.type === 'closed')).toBeGreaterThan(relation)
    const count = events.length
    await observation.drain()
    expect(events).toHaveLength(count)
  }
  expect(errors).toEqual([])
})
