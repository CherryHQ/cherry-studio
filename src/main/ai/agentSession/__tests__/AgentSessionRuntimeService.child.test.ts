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
  const context = contexts.child(parent.id, 'child', 'child', 'spawn', 'Child')
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
  return { service, sender, destroy, ready, connection, connect, view, listeners }
}

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
