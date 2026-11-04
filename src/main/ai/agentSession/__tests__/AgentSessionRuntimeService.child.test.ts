import { EventEmitter } from 'node:events'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnection, AgentRuntimeEvent } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { savedChildView } from '../ChildThreadProjection'

vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = { DbService: defaultServiceInstances.DbService, AiStreamManager: { abort: vi.fn() } }
  return mockApplicationFactory(overrides)
})

const dbh = setupTestDatabase()
const replyId = '01900000-0000-7000-8000-000000000001'
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

function fixture() {
  dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey: 'a0' }).run()
  dbh.db
    .insert(userModelTable)
    .values({
      id: 'test::model',
      providerId: 'test',
      modelId: 'model',
      name: 'Model',
      capabilities: [],
      supportsStreaming: true,
      orderKey: 'a0'
    })
    .run()
  dbh.db
    .insert(agentTable)
    .values({
      id: 'agent',
      type: 'pi',
      name: 'Agent',
      instructions: '',
      model: 'test::model',
      orderKey: 'a0'
    })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0' })
    .run()
  const parent = preparePiBranch('root')
  const context = contexts.child(parent.id, 'child', 'spawn', 'Child')
  messages.saveMessagesTx(dbh.db, {
    sessionId: context.sessionId,
    parentId: context.anchorMessageId!,
    messages: [
      { id: replyId, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Saved answer' }] } }
    ]
  })
  const view: AgentChildView = { ...savedChildView(context), available: true }
  const listeners = new Set<(update: AgentChildUpdate) => void>()
  const ready = Promise.withResolvers<AgentRuntimeConnection>()
  const closed = Promise.withResolvers<void>()
  const connection: AgentRuntimeConnection = {
    events: {
      async *[Symbol.asyncIterator]() {
        await closed.promise
        yield* [] as AgentRuntimeEvent[]
      }
    },
    send: async () => {},
    close: async () => {
      closed.resolve()
    },
    reconcile: async () => 'current',
    childProjection: async () => ({
      snapshot: () => view,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    })
  }
  const connect = vi.fn(() => ready.promise)
  runtimeDriverRegistry.register({
    type: 'pi',
    capabilities: ['agent-session'],
    connect,
    validateSession: () => {},
    listAvailableTools: async () => []
  })
  const service = new AgentSessionRuntimeService()
  const emitter = new EventEmitter()
  let destroyed = false
  const sender = Object.assign(emitter, { isDestroyed: () => destroyed }) as Electron.WebContents
  const destroy = () => {
    destroyed = true
    emitter.emit('destroyed')
  }
  onTestFinished(async () => {
    destroy()
    ready.resolve(connection)
    await service.closeSession('root')
    runtimeDriverRegistry.clearForTest()
  })
  return { service, sender, destroy, ready, connection, connect, view, listeners, context }
}

// Catches child IPC writing while backup holds admission, including overlapping pause owners.
it('rejects child input until the final writer pause is released', async () => {
  const f = fixture()
  const sent: string[] = []
  f.connection.messageChild = async (_contextId, text) => {
    sent.push(text)
  }
  f.ready.resolve(f.connection)
  await f.service.primeConnection('root')
  const first = f.service.pause('backup')
  const last = f.service.pause('restore')
  try {
    await expect(f.service.messageChild('root', f.context.id, 'blocked')).rejects.toThrow('paused')
    first.dispose()
    await expect(f.service.messageChild('root', f.context.id, 'still blocked')).rejects.toThrow('paused')
    expect(sent).toEqual([])
    last.dispose()
    await f.service.messageChild('root', f.context.id, 'allowed')
    expect(sent).toEqual(['allowed'])
  } finally {
    first.dispose()
    last.dispose()
  }
})

// Catches admission reopening between shutdown beginning and native-owner teardown.
it('rejects child input once shutdown begins', async () => {
  const f = fixture()
  const sent: string[] = []
  f.connection.messageChild = async (_contextId, text) => {
    sent.push(text)
  }
  f.ready.resolve(f.connection)
  await f.service.primeConnection('root')
  const stopping = f.service._doStop()
  await expect(f.service.messageChild('root', f.context.id, 'too late')).rejects.toThrow('paused')
  await stopping
  expect(sent).toEqual([])
})

// Catches backup declaring the root idle while an admitted child still has a delayed archive write.
it.each(['complete', 'reject'] as const)('drains admitted child input when it will %s', async (outcome) => {
  const f = fixture()
  const ready = Promise.withResolvers<void>()
  f.connection.messageChild = async () => {
    await ready.promise
    if (outcome === 'reject') throw new Error('Child input rejected')
    messages.saveMessage({
      sessionId: f.context.sessionId,
      message: {
        id: '01900000-0000-7000-8000-000000000002',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'continue' }] }
      }
    })
  }
  f.ready.resolve(f.connection)
  await f.service.primeConnection('root')
  const sending = f.service.messageChild('root', f.context.id, 'continue')
  const result = sending.catch((error: unknown) => error)
  const hold = f.service.pause('backup')
  try {
    expect(await f.service.drainInFlight({ timeoutMs: 10 })).toEqual({ stragglerIds: ['root'] })
    expect(f.service.hasBusySessions()).toBe(true)
    expect(f.service.listActiveWork()).toEqual([expect.objectContaining({ id: 'root' })])
    const draining = f.service.drainInFlight({ timeoutMs: 5_000 })
    ready.resolve()
    expect(await draining).toEqual({ stragglerIds: [] })
    if (outcome === 'reject') expect(await result).toEqual(new Error('Child input rejected'))
    else {
      expect(await result).toBeUndefined()
      expect(savedChildView(f.context).messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'continue' }])
    }
    expect(f.service.hasBusySessions()).toBe(false)
    expect(f.service.listActiveWork()).toEqual([])
  } finally {
    ready.resolve()
    await result
    hold.dispose()
  }
})

// Catches an admission acknowledgement being mistaken for completion of native/archive writes.
it('drains child native work and archive writes after the input acknowledgement', async () => {
  const f = fixture()
  const admission = Promise.withResolvers<void>()
  const archive = Promise.withResolvers<void>()
  let acknowledged = false
  f.connection.messageChild = async () => {
    await admission.promise
    acknowledged = true
  }
  f.connection.drainChildWrites = async () => {
    expect(acknowledged).toBe(true)
    await archive.promise
    messages.saveMessage({
      sessionId: f.context.sessionId,
      message: {
        id: '01900000-0000-7000-8000-000000000003',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Final answer' }] }
      }
    })
  }
  f.ready.resolve(f.connection)
  await f.service.primeConnection('root')
  const sending = f.service.messageChild('root', f.context.id, 'continue')
  const hold = f.service.pause('backup')
  try {
    const verdict = f.service.drainInFlight({ timeoutMs: 25 })
    admission.resolve()
    await sending
    expect(await verdict).toEqual({ stragglerIds: ['root'] })
    const draining = f.service.drainInFlight({ timeoutMs: 5_000 })
    archive.resolve()
    expect(await draining).toEqual({ stragglerIds: [] })
    expect(savedChildView(f.context).messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'Final answer' }])
  } finally {
    admission.resolve()
    archive.resolve()
    await sending
    hold.dispose()
  }
})

// Catches a failed archive flush being accepted as a clean backup boundary.
it('reports failed child write drains and allows the next drain to retry', async () => {
  const f = fixture()
  f.connection.drainChildWrites = async () => {
    throw new Error('Archive unavailable')
  }
  f.ready.resolve(f.connection)
  await f.service.primeConnection('root')
  const hold = f.service.pause('backup')
  try {
    expect(await f.service.drainInFlight({ timeoutMs: 100 })).toEqual({ stragglerIds: ['root'] })
    f.connection.drainChildWrites = async () => {}
    expect(await f.service.drainInFlight({ timeoutMs: 100 })).toEqual({ stragglerIds: [] })
  } finally {
    hold.dispose()
  }
})

// Catches attaching during prewarm returning an unavailable archive with no later subscription.
it('waits for an in-flight prewarm and delivers child updates without another attach', async () => {
  const f = fixture()
  const priming = f.service.primeConnection('root')
  await expect.poll(() => f.connect.mock.calls.length).toBe(1)
  const received: AgentChildUpdate[] = []
  const attaching = f.service.attachChild(f.sender, 'root', 'spawn', 'subscription', (update) => received.push(update))
  f.ready.resolve(f.connection)
  await priming
  expect(await attaching).toEqual(f.view)
  const update: AgentChildUpdate = {
    revision: 1,
    patches: [{ type: 'append', messageId: replyId, part: 0, text: ' continued' }],
    order: [replyId],
    active: true,
    available: true
  }
  for (const listener of f.listeners) listener(update)
  expect(received).toEqual([update])
  expect(f.connect.mock.calls).toHaveLength(1)
  f.service.detachChild(f.sender, 'subscription')
  expect(f.listeners.size).toBe(0)
})

// Catches a late connection installing a subscription after its requesting window has gone away.
it.each(['detach', 'destroy', 'close'] as const)(
  'does not attach after %s while the connection is pending',
  async (action) => {
    const f = fixture()
    const priming = f.service.primeConnection('root')
    await expect.poll(() => f.connect.mock.calls.length).toBe(1)
    const attaching = f.service.attachChild(f.sender, 'root', 'spawn', 'subscription', () => {})
    if (action === 'detach') f.service.detachChild(f.sender, 'subscription')
    if (action === 'destroy') f.destroy()
    const closing = action === 'close' ? f.service.closeSession('root') : undefined
    f.ready.resolve(f.connection)
    await priming
    await closing
    if (action === 'close') expect(await attaching).toMatchObject({ available: false })
    else expect(await attaching).toBeNull()
    expect(f.listeners.size).toBe(0)
  }
)

// Catches a late child projection subscribing a detached panel or a retired owner.
it.each(['detach', 'destroy', 'close'] as const)(
  'does not subscribe after %s while the child is opening',
  async (action) => {
    const f = fixture()
    const reached = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    const project = f.connection.childProjection!.bind(f.connection)
    vi.spyOn(f.connection, 'childProjection').mockImplementation(async (toolCallId) => {
      reached.resolve()
      await ready.promise
      return project(toolCallId)
    })
    try {
      f.ready.resolve(f.connection)
      await f.service.primeConnection('root')
      const attaching = f.service.attachChild(f.sender, 'root', 'spawn', 'subscription', () => {})
      await reached.promise
      if (action === 'detach') f.service.detachChild(f.sender, 'subscription')
      if (action === 'destroy') f.destroy()
      if (action === 'close') await f.service.closeSession('root')
      ready.resolve()
      expect(await attaching).toBeNull()
      expect(f.listeners.size).toBe(0)
    } finally {
      ready.resolve()
    }
  }
)

// Catches losing readable persisted output when the native owner cannot be opened.
it('returns the saved read-only child when connection fails', async () => {
  const f = fixture()
  const attaching = f.service.attachChild(f.sender, 'root', 'spawn', 'subscription', () => {})
  f.ready.reject(new Error('Owner unavailable'))
  expect(await attaching).toMatchObject({
    available: false,
    messages: [{ id: replyId, parts: [{ text: 'Saved answer' }] }]
  })
  expect(f.listeners.size).toBe(0)
})
