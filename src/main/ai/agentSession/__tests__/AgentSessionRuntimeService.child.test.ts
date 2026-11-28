import { EventEmitter } from 'node:events'

import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances, MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { AiService } from '@main/ai/AiService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnection, AgentRuntimeEvent } from '@main/ai/runtime/types'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'
import type { ProjectionNotification } from '@shared/ai/messageProjection'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { savedChildView } from '../childArchive'
import { childTimelines } from '../childTimelines'

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
    contextId: parent.id,
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
    reconcile: async () => 'current'
  }
  const connect = vi.fn(() => ready.promise)
  runtimeDriverRegistry.register({
    type: 'pi',
    connect,
    validateSession: () => {}
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

// Desktop projections carry no listener window; the initiating command still owns MCP consent.
it.each([false, true])('resolves MCP interactions from the initiating window (headless: %s)', async (headless) => {
  const f = fixture()
  MockApplicationUtils.setService('AgentSessionRuntimeService', f.service)
  MockApplicationUtils.setService('AiStreamManager', new AiStreamManager())
  defaultServiceInstances.WindowManager.getWindow.mockReturnValue({} as never)
  onTestFinished(() => {
    MockApplicationUtils.resetServices()
    defaultServiceInstances.WindowManager.getWindow.mockReset()
  })
  const turn = f.service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: replyId,
    headless
  })
  const stream = await new AiService().streamText({
    conversation: { id: 'root', topicId: 'agent-session:root' },
    trigger: 'submit-message',
    runtime: { kind: 'agent-session', sessionId: 'root', turnId: turn.turnId },
    interactionWindowId: 'window-1',
    requestOptions: { signal: turn.abortController.signal }
  })
  expect(f.service.getMcpInteractionHost('root')).toEqual(
    headless ? undefined : { windowId: 'window-1', topicId: 'agent-session:root', model: 'test::model' }
  )
  defaultServiceInstances.WindowManager.getWindow.mockReturnValue(undefined)
  expect(f.service.getMcpInteractionHost('root')).toBeUndefined()
  await stream.stream.cancel()
})

it('sends to the archived child owner while another branch is selected', async () => {
  const f = fixture()
  const sessionId = 'root'
  const root = contexts.context(f.context.parentContextId!)
  const other = messages.saveMessage({
    sessionId,
    parentId: root.anchorMessageId!,
    message: {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Different branch' }] }
    }
  })
  contexts.reserveBranchTx(dbh.db, {
    sessionId,
    backendId: root.backendId,
    nativeThreadId: 'other-native-root',
    anchorMessageId: other.id
  })
  const sent: string[] = []
  f.connection.messageChild = async (contextId, text) => {
    sent.push(contextId, text)
  }
  f.ready.resolve(f.connection)
  try {
    await f.service.messageChild(sessionId, f.context.id, 'Continue the archived child')
    expect(f.connect.mock.calls[0]).toMatchObject([{ sessionId, branchHead: root.anchorMessageId }])
    expect(sent).toEqual([f.context.id, 'Continue the archived child'])
    expect(f.service.inspect(sessionId)).toBeUndefined()
    expect(messages.branchTip(sessionId, root.anchorMessageId!, dbh.db, root.id)).toBe(root.anchorMessageId)
  } finally {
    await f.service._doDestroy()
  }
})

// Catches child IPC writing while backup holds admission, including overlapping pause owners.
it('rejects child input until the final writer pause is released', async () => {
  const f = fixture()
  const sent: string[] = []
  f.connection.messageChild = async (_contextId, text) => {
    sent.push(text)
  }
  f.ready.resolve(f.connection)
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
  f.connection.messageChild = async () => {}
  await f.service.messageChild('root', f.context.id, 'continue')
  const hold = f.service.pause('backup')
  try {
    expect(await f.service.drainInFlight({ timeoutMs: 100 })).toEqual({ stragglerIds: ['root'] })
    f.connection.drainChildWrites = async () => {}
    expect(await f.service.drainInFlight({ timeoutMs: 100 })).toEqual({ stragglerIds: [] })
  } finally {
    hold.dispose()
  }
})

it('keeps both passive viewers subscribed across child creation and never opens a runtime to browse', async () => {
  const f = fixture()
  const early: ProjectionNotification[] = []
  const attach = (call: string, id: string, seen = early) =>
    childTimelines.attach(f.sender, 'root', call, id, (value) => seen.push(value))
  expect(await attach('future', 'first')).toBeNull()
  expect(await attach('spawn', 'archive')).toMatchObject({
    available: false,
    canSubmit: true,
    messages: [{ id: replyId, parts: [{ text: 'Saved answer' }] }]
  })
  const { MessageProjection } = await import('@main/ai/messages/MessageProjection')
  const second: ProjectionNotification[] = []
  const attaching = attach('future', 'second', second)
  const child = contexts.child(f.context.parentContextId!, 'future-native', 'future', 'Future child')
  const baseline = savedChildView(child)
  const live = new MessageProjection({ ...baseline, available: true, canSubmit: true })
  const retire = childTimelines.publish(child, {
    snapshot: () => live.snapshot(),
    subscribe: (listener) => live.subscribe(listener),
    getToolResult: () => undefined
  })
  onTestFinished(retire)
  expect(early).toEqual([{ kind: 'source-changed' }])
  expect(await attach('future', 'first')).toMatchObject({ available: true, messages: [] })
  expect(await attaching).toMatchObject({ available: true, messages: [] })
  live.updateAccepted(
    {
      ...baseline,
      available: true,
      canSubmit: true,
      messages: [{ id: 'new', role: 'assistant', parts: [{ type: 'text', text: 'first output' }] }]
    },
    true
  )
  expect(early.slice(1)).toEqual(second)
  expect(second).toMatchObject([{ patches: [{ type: 'message', message: { id: 'new' } }] }])
  childTimelines.subscriptions.detach(f.sender, 'first')
  f.destroy()
  retire()
  expect(second).toHaveLength(1)
  expect(f.connect).not.toHaveBeenCalled()
})
