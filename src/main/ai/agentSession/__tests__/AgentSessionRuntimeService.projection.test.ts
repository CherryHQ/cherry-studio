import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { ClaudeCodeSessionStateService } from '@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService'
import { surfaceExitPlanModeInput } from '@main/ai/runtime/claudeCode/hooks'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent, RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { StartRuntimeTurnInput } from '@main/ai/streamManager/AiStreamManager'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import type { StreamDoneResult, StreamPausedResult } from '@main/ai/streamManager/types'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { CherryUIMessage } from '@shared/data/types/message'
import { AsyncEventQueue } from '@shared/utils/async'

import { AgentFileSnapshotService } from '../AgentFileSnapshotService'
import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { RootMessageProjection } from '../RootMessageProjection'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

async function fixture(
  interrupt?: (emit: (event: AgentRuntimeEvent) => Promise<void>) => Promise<void>,
  retainOnStop = false,
  agentType: 'pi' | 'pi-durable' = 'pi'
) {
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
    .values({ id: 'agent', type: agentType, name: 'Agent', instructions: '', model: 'test::model', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0' })
    .run()
  const context = preparePiBranch('root')
  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Prompt' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  let queue = new AsyncEventQueue<{ event: AgentRuntimeEvent; consumed: () => void }>()
  const closed = Promise.withResolvers<void>()
  // Durable's record of every input state the test reports.
  const recorded = new Map<string, Extract<AgentRuntimeEvent, { type: 'input-state' }>['input']>()
  const emit = (event: AgentRuntimeEvent) => {
    if (event.type === 'input-state' && event.input.inputId) recorded.set(event.input.inputId, event.input)
    return new Promise<void>((consumed) => queue.push({ event, consumed }))
  }
  const connections = { opened: 0, closed: 0, sent: [] as string[], followUps: [] as string[], steers: [] as string[] }
  runtimeDriverRegistry.register({
    type: agentType,
    validateSession: () => {},
    connect: async () => {
      connections.opened++
      const activeQueue = queue
      return {
        contextId: context.id,
        events: {
          async *[Symbol.asyncIterator]() {
            for await (const next of activeQueue) {
              try {
                yield next.event
              } finally {
                next.consumed()
              }
            }
          }
        },
        send: async ({ message }) => {
          connections.sent.push(message.id)
        },
        redirect: ({ message }: { message: { id: string } }) => {
          connections.steers.push(message.id)
          return true
        },
        ...(agentType === 'pi-durable' && {
          followUp: ({ message }: { message: { id: string } }) => {
            connections.followUps.push(message.id)
            return true
          },
          lookupInput: async (_contextId: string, inputId: string) => {
            const input = recorded.get(inputId)
            return {
              status: 'confirmed' as const,
              value: input ? { found: true as const, input } : { found: false as const }
            }
          }
        }),
        close: async () => {
          connections.closed++
          activeQueue.close()
          closed.resolve()
        },
        reconcile: async () => 'current',
        retainWhileIdle: true,
        retainOnStop,
        ...(interrupt && { interrupt: () => interrupt(emit) })
      }
    }
  })
  const service = new AgentSessionRuntimeService()
  const handle = service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType,
    modelId: 'test::model',
    assistantMessageId: reply.id,
    userMessage: user,
    shouldAutoName: true
  })
  const source = service.openTurnStream({
    sessionId: 'root',
    turnId: handle.turnId,
    signal: handle.abortController.signal
  })
  if (source.kind !== 'messages') throw new Error('Agent turns must expose messages')
  const views: CherryUIMessage[] = []
  const done = pipeMessageStream(
    source.stream,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant', parts: [] },
    (message) => views.push(message),
    () => {}
  )
  const project = (native: CherryUIMessage[], extra: Partial<RuntimeMessageProjection> = {}) =>
    emit({
      type: 'message-projection',
      projection: {
        contextId: context.id,
        messages: native,
        live: native.map((message) => message.id),
        replaces: {},
        removed: [],
        ...extra
      }
    })
  await project([])
  onTestFinished(async () => {
    await service.closeSession('root')
    runtimeDriverRegistry.clearForTest()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
  })
  const reconnect = async () => {
    queue.close()
    await closed.promise
    queue = new AsyncEventQueue()
    await service.primeConnection('root')
  }
  return { service, handle, context, user, reply, emit, project, views, done, reconnect, connections }
}
const text = (id: string, value: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: value, state: 'done' }]
})

async function settleFirstTurn(f: Awaited<ReturnType<typeof fixture>>) {
  await f.project([text('first', 'First answer')])
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
}

it.each([false, true])('attests a live snapshot round when a newer persisted reply exists: %s', async (newer) => {
  const f = await fixture()
  dbh.db
    .update(agentSessionMessageTable)
    .set({ status: 'success', createdAt: 1 })
    .where(eq(agentSessionMessageTable.id, f.reply.id))
    .run()
  const followup = savedUser(f.reply.id, 'Follow-up')
  f.service.enqueueUserMessage('root', followup)
  await f.emit({ type: 'steer-boundary', inputIds: [followup.id] })
  const round = f.service.getLiveSnapshotRound('root')!
  expect(round.replyId).not.toBe(f.reply.id)
  if (newer) {
    const reply = messages.saveMessage({
      sessionId: 'root',
      message: { role: 'assistant', status: 'success', data: { parts: [] } }
    })
    dbh.db
      .update(agentSessionMessageTable)
      .set({ createdAt: Date.now() + 10_000 })
      .where(eq(agentSessionMessageTable.id, reply.id))
      .run()
  }
  expect(f.service.attestSnapshotRound('root')).toBe(newer ? null : round.replyId)
})

it.each(['native', 'terminal', 'stop'] as const)(
  'finishes the snapshot after the %s terminal path',
  async (terminal) => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-terminal-'))
    const workspace = path.join(testDir, 'workspace')
    await mkdir(workspace)
    onTestFinished(() => rm(testDir, { recursive: true, force: true }))
    const snapshots = new AgentFileSnapshotService()
    MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
    MockApplicationUtils.setService('AiStreamManager', { drainRuntimeReply: async () => {} })
    const f = await fixture()
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    const round = f.service.getLiveSnapshotRound('root')!
    expect(f.service.attestSnapshotRound('root')).toBe(round.replyId)
    expect(f.service.attestSnapshotRound('missing')).toBeNull()
    const target = path.join(workspace, 'file')
    await writeFile(target, 'before')
    const { attemptId } = await snapshots.protectWrite({
      round,
      callId: 'call',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'after' } },
      filePath: target,
      cwd: workspace
    })
    await writeFile(target, 'after')
    await snapshots.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    expect((await snapshots.getUndoState('root')).reason).toBe('turn-active')
    if (terminal === 'native') await f.emit({ type: 'turn-complete' })
    else if (terminal === 'terminal') f.service.markTurnTerminal('root', 'paused', f.handle.turnId)
    else await f.service.stopSession('root', 'user-requested')
    const state = await snapshots.getUndoState('root')
    expect(f.service.attestSnapshotRound('root')).toBe(f.reply.id)
    expect(state).toMatchObject({ replyId: f.reply.id, canUndo: true, reason: null })
    expect(
      await snapshots.undoCurrentRound({ sessionId: 'root', replyId: f.reply.id, expectedRevision: state.revision! })
    ).toMatchObject({ reason: null })
    expect(await readFile(target, 'utf8')).toBe('before')
  }
)

it.each(['native', 'listener'] as const)(
  'keeps the snapshot active until stop is confirmed after the %s terminal',
  async (terminal) => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-stop-'))
    const workspace = path.join(testDir, 'workspace')
    await mkdir(workspace)
    onTestFinished(() => rm(testDir, { recursive: true, force: true }))
    const snapshots = new AgentFileSnapshotService()
    MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
    MockApplicationUtils.setService('AiStreamManager', {
      drainRuntimeReply: async () => {},
      pauseRuntimeTurn: () => {}
    })
    const interrupt = Promise.withResolvers<void>()
    const f = await fixture(() => interrupt.promise, true, 'pi-durable')
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    const round = f.service.getLiveSnapshotRound('root')!
    const target = path.join(workspace, 'file')
    await writeFile(target, 'before')
    const { attemptId } = await snapshots.protectWrite({
      round,
      callId: 'stop',
      runtime: 'pi-durable',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'after' } },
      filePath: target,
      cwd: workspace
    })
    await writeFile(target, 'after')
    await snapshots.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    const stopped = f.service.stopSession('root', 'user-requested')
    if (terminal === 'native') await f.emit({ type: 'turn-complete', status: 'paused' })
    else f.service.markTurnTerminal('root', 'paused', f.handle.turnId)
    const duringStop = await snapshots.getUndoState('root')
    interrupt.resolve()
    await f.emit({ type: 'stop-confirmed' })
    await stopped
    expect(duringStop).toMatchObject({ canUndo: false, reason: 'turn-active' })
    expect(await snapshots.getUndoState('root')).toMatchObject({ canUndo: true, reason: null })
  }
)

it.each(['queued', 'steer'] as const)('attributes a %s successor write to its own reply', async (kind) => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-successor-'))
  const workspace = path.join(testDir, 'workspace')
  await mkdir(workspace)
  onTestFinished(() => rm(testDir, { recursive: true, force: true }))
  const snapshots = new AgentFileSnapshotService()
  MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    },
    drainRuntimeReply: async () => {}
  })
  const f = await fixture()
  vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
  const followup = savedUser(f.reply.id, 'Follow-up')
  f.service.enqueueUserMessage('root', followup, kind === 'queued' ? { headless: true } : {})
  if (kind === 'queued') {
    await f.emit({ type: 'turn-complete' })
    const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
    await f.handle.listeners[0].onDone(result)
    await f.handle.listeners[1].onDone(result)
    await expect.poll(() => next).toBeDefined()
  } else {
    await f.emit({ type: 'steer-boundary', inputIds: [followup.id] })
  }
  const round = f.service.getLiveSnapshotRound('root')!
  expect(round).toMatchObject({ inputMessageIds: [followup.id] })
  expect(round.replyId).not.toBe(f.reply.id)
  expect(f.service.attestSnapshotRound('root')).toBe(round.replyId)
  const target = path.join(workspace, 'file')
  await writeFile(target, 'before')
  await snapshots.protectWrite({
    round,
    callId: kind,
    runtime: 'pi',
    toolName: 'write',
    intent: { toolName: 'write', input: { content: 'after' } },
    filePath: target,
    cwd: workspace
  })
  const manifest = JSON.parse(
    await readFile(path.join(testDir, 'snapshots/root', round.replyId, 'manifest.json'), 'utf8')
  )
  expect(manifest).toMatchObject({ replyId: round.replyId, inputMessageIds: [followup.id], files: [{ path: target }] })
  if (kind === 'steer') {
    f.service.markTurnTerminal('root', 'success', f.handle.turnId)
    expect(await snapshots.getUndoState('root')).toMatchObject({ replyId: round.replyId, reason: 'turn-active' })
  }
})

it('rejects the old on-disk round when the actual runtime admits an unwritten successor', async () => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-attestation-'))
  const workspace = path.join(testDir, 'workspace')
  await mkdir(workspace)
  onTestFinished(() => rm(testDir, { recursive: true, force: true }))
  const snapshots = new AgentFileSnapshotService()
  MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    },
    drainRuntimeReply: async () => {}
  })
  const f = await fixture()
  vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
  const first = f.service.getLiveSnapshotRound('root')!
  const target = path.join(workspace, 'file')
  await writeFile(target, 'before')
  const attempt = await snapshots.protectWrite({
    round: first,
    callId: 'first',
    runtime: 'pi',
    toolName: 'write',
    filePath: target,
    cwd: workspace,
    intent: { toolName: 'write', input: { content: 'after' } }
  })
  await writeFile(target, 'after')
  await snapshots.settleWrite({ round: first, attemptId: attempt.attemptId!, outcome: 'success' })
  f.service.enqueueUserMessage('root', savedUser(f.reply.id, 'Follow-up'), { headless: true })
  await settleFirstTurn(f)
  await expect.poll(() => next).toBeDefined()
  await snapshots.markRoundFinished('root', first.replyId)
  const attested = () => f.service.attestSnapshotRound('root')
  expect(attested()).not.toBe(first.replyId)
  const currentPath = path.join(testDir, 'snapshots/root/current.json')
  const manifestPath = path.join(testDir, 'snapshots/root', first.replyId, 'manifest.json')
  const current = await readFile(currentPath)
  const manifest = await readFile(manifestPath)
  expect(await snapshots.getUndoState('root', attested)).toMatchObject({ canUndo: false, reason: 'stale' })
  expect(
    await snapshots.undoCurrentRound({ sessionId: 'root', replyId: first.replyId, expectedRevision: '1' }, attested)
  ).toMatchObject({ reason: 'stale', files: [] })
  expect(await readFile(currentPath)).toEqual(current)
  expect(await readFile(manifestPath)).toEqual(manifest)
  expect(await readFile(target, 'utf8')).toBe('after')
})

it.each([true, false])(
  'keeps merged steer inputs attached to their shared snapshot reply (another write: %s)',
  async (anotherWrite) => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-merged-steer-'))
    const workspace = path.join(testDir, 'workspace')
    await mkdir(workspace)
    onTestFinished(() => rm(testDir, { recursive: true, force: true }))
    const snapshots = new AgentFileSnapshotService()
    MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
    MockApplicationUtils.setService('AiStreamManager', {
      startRuntimeTurn: () => {},
      drainRuntimeReply: async () => {}
    })
    const f = await fixture()
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    const first = savedUser(f.reply.id, 'First steer')
    const second = savedUser(first.id, 'Second steer')
    f.service.enqueueUserMessage('root', first)
    f.service.enqueueUserMessage('root', second)
    await f.emit({ type: 'steer-boundary', inputIds: [first.id] })
    const firstRound = f.service.getLiveSnapshotRound('root')!
    const target = path.join(workspace, 'file')
    await writeFile(target, 'before')
    const attempt = await snapshots.protectWrite({
      round: firstRound,
      callId: 'first',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'first' } },
      filePath: target,
      cwd: workspace
    })
    await f.emit({ type: 'steer-boundary', inputIds: [second.id] })
    const merged = f.service.getLiveSnapshotRound('root')!
    expect(merged).toMatchObject({ replyId: firstRound.replyId, inputMessageIds: [first.id, second.id] })
    if (anotherWrite)
      await snapshots.protectWrite({
        round: merged,
        callId: 'second',
        runtime: 'pi',
        toolName: 'write',
        intent: { toolName: 'write', input: { content: 'second' } },
        filePath: target,
        cwd: workspace
      })
    await snapshots.settleWrite({ round: firstRound, attemptId: attempt.attemptId!, outcome: 'failure' })
    const manifest = JSON.parse(
      await readFile(path.join(testDir, 'snapshots/root', merged.replyId, 'manifest.json'), 'utf8')
    )
    expect(manifest.inputMessageIds).toEqual([first.id, second.id])
    expect(manifest.files[0].attempts).toHaveLength(anotherWrite ? 2 : 1)
  }
)

it.each(['goal-round', 'background-work'] as const)(
  'attributes a %s write to the correct reply and baseline',
  async (kind) => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-autonomous-'))
    const workspace = path.join(testDir, 'workspace')
    await mkdir(workspace)
    onTestFinished(() => rm(testDir, { recursive: true, force: true }))
    const snapshots = new AgentFileSnapshotService()
    MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
    MockApplicationUtils.setService('AiStreamManager', {
      startRuntimeTurn: () => {},
      drainRuntimeReply: async () => {}
    })
    const f = await fixture()
    vi.spyOn(application, 'getPath').mockReturnValue(path.join(testDir, 'snapshots'))
    const target = path.join(workspace, 'file')
    await writeFile(target, 'before')
    const first = f.service.getLiveSnapshotRound('root')!
    if (kind === 'background-work') {
      const { attemptId } = await snapshots.protectWrite({
        round: first,
        callId: 'first',
        runtime: 'pi',
        toolName: 'write',
        intent: { toolName: 'write', input: { content: 'first' } },
        filePath: target,
        cwd: workspace
      })
      await writeFile(target, 'first')
      await snapshots.settleWrite({
        round: first,
        attemptId: attemptId!,
        outcome: 'success'
      })
      await settleFirstTurn(f)
    } else await settleFirstTurn(f)
    await f.emit({
      type: 'autonomous-turn-state',
      state: 'started',
      origin: kind === 'goal-round' ? { kind, round: 1 } : { kind }
    })
    const round = f.service.getLiveSnapshotRound('root')!
    if (kind === 'background-work') expect(round.replyId).toBe(first.replyId)
    else expect(round.replyId).not.toBe(first.replyId)
    const { attemptId } = await snapshots.protectWrite({
      round,
      callId: 'continued',
      runtime: 'pi',
      toolName: 'write',
      intent: { toolName: 'write', input: { content: 'continued' } },
      filePath: target,
      cwd: workspace
    })
    await writeFile(target, 'continued')
    await snapshots.settleWrite({ round, attemptId: attemptId!, outcome: 'success' })
    if (kind === 'background-work') {
      const manifest = JSON.parse(
        await readFile(path.join(testDir, 'snapshots/root', round.replyId, 'manifest.json'), 'utf8')
      )
      expect(manifest.inputMessageIds).toEqual([f.user.id])
      expect(manifest.files).toHaveLength(1)
      expect(manifest.files[0].attempts).toHaveLength(2)
    }
    expect(await snapshots.getUndoState('root')).toMatchObject({ replyId: round.replyId, reason: 'turn-active' })
    await snapshots.markRoundFinished('root', round.replyId)
    const state = await snapshots.getUndoState('root')
    expect(
      await snapshots.undoCurrentRound({ sessionId: 'root', replyId: round.replyId, expectedRevision: state.revision! })
    ).toMatchObject({ reason: null })
    expect(await readFile(target, 'utf8')).toBe('before')
  }
)

/** A user input and its reply left unsettled by an exit; Durable reports it as `native-user`. */
function unsettledInput(parentId: string) {
  const user = messages.saveMessage({
    sessionId: 'root',
    parentId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Before exit' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    parentId: user.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const native: CherryUIMessage = { id: 'native-user', role: 'user', parts: [{ type: 'text', text: 'Before exit' }] }
  return { user, reply, native, inputs: { [native.id]: user.id } }
}

it('continues a session after deleting a completed projected reply and reconnecting', async () => {
  const f = await fixture()
  await f.project([text('old', 'Deleted answer')])
  await f.emit({ type: 'turn-complete' })
  const completed: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(completed)
  await f.handle.listeners[1].onDone(completed)
  await f.service.closeSession('root')
  messages.deleteSessionMessage('root', f.reply.id)
  await f.reconnect()
  await f.project([text('old', 'Archive replay')], { live: [] })

  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Next question' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const handle = f.service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: reply.id,
    userMessage: user
  })
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: handle.turnId,
    signal: handle.abortController.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message projections')
  const done = pipeMessageStream(
    source.stream,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant', parts: [] },
    () => {},
    () => {}
  )
  await f.project([text('old', 'Late replay'), text('new', 'Next answer')])
  await f.emit({ type: 'turn-complete' })
  const result = await done
  expect(result.threw).toBeUndefined()
  const outcome: StreamDoneResult = { status: 'success', finalMessage: result.finalMessage }
  await handle.listeners[0].onDone(outcome)
  await handle.listeners[1].onDone(outcome)
  expect(messages.getSessionMessage('root', reply.id)).toMatchObject({
    status: 'success',
    data: { parts: text('', 'Next answer').parts }
  })
  expect(messages.hasSessionMessage('root', f.reply.id)).toBe(false)
  expect(f.service.inspect('root')?.status).toBe('idle')
})

// #24732: Durable records the user's stop before the connection closes; closing must not rewrite it as an error.
it('keeps a stopped reply paused when the runtime reports the abort before closing', async () => {
  const stopped = Promise.withResolvers<void>()
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async (emit) => {
    await stopped.promise
    await emit({ type: 'turn-complete', status: 'paused' })
  })
  await f.project([text('partial', 'Partial answer')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
  f.handle.abortController.abort('agent-runtime-interrupt')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  stopped.resolve()
  await f.service.closeSession('root')

  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'paused',
    data: { parts: text('', 'Partial answer').parts }
  })
})

it('keeps a retained connection open on Stop and starts later input only after native confirmation', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false,
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(async () => {}, true)
  const terminals: string[] = []
  f.service.onTurnTerminal((event) => void (event.assistantMessageId === f.reply.id && terminals.push(event.status)))
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('partial', 'Partial answer')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const followup = messages.saveMessage({
    sessionId: 'root',
    parentId: f.reply.id,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'After Stop' }] } }
  })
  f.service.enqueueUserMessage('root', followup)

  await f.emit({ type: 'turn-complete', status: 'paused' })
  expect(f.service.isSessionBusy('root')).toBe(true)
  expect(next).toBeUndefined()
  await f.emit({ type: 'stop-confirmed' })

  await vi.waitFor(() => expect(next?.listeners).toBeDefined())
  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'paused',
    data: { parts: text('', 'Partial answer').parts }
  })
  expect(f.connections.opened).toBe(1)
  expect(f.connections.closed).toBe(0)
  await vi.waitFor(() => expect(terminals).toEqual(['paused']))
})

// AC5: Durable resumes a placed input after an unclean exit; its output must not land in the latest reply.
it('continues a resumed Durable input in its original reply', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const left = unsettledInput(f.reply.id)

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: left.user.id
  })
  await expect.poll(() => next).toBeDefined()
  expect(next!.request.messageId).toBe(left.reply.id)
  const runtime = next!.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a resumed runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next!.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const done = pipeMessageStream(
    source.stream,
    next!.abortController!.signal,
    { id: left.reply.id, role: 'assistant', parts: [] },
    () => {},
    () => {}
  )
  await f.project([left.native, text('committed', 'Committed before exit')], { live: [], inputs: left.inputs })
  await f.project([text('resumed', 'Resumed after reopen')])
  await f.emit({ type: 'turn-complete' })
  await next!.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })

  expect(messages.getSessionMessage('root', left.reply.id)).toMatchObject({
    status: 'success',
    data: { parts: [...text('', 'Committed before exit').parts, ...text('', 'Resumed after reopen').parts] }
  })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

function savedUser(parentId: string, value: string) {
  return messages.saveMessage({
    sessionId: 'root',
    parentId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: value }] } }
  })
}

// Inputs queued before their replies exist sit above those replies, so row ancestry names the wrong input.
it('links each steered input to the reply opened for it', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture()
  await f.project([text('first', 'Original answer')])
  const first = savedUser(f.reply.id, 'First steer')
  f.service.enqueueUserMessage('root', first)
  const second = savedUser(first.id, 'Second steer')
  f.service.enqueueUserMessage('root', second)
  await f.emit({ type: 'steer-boundary', inputIds: [first.id] })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  await expect.poll(() => next).toBeDefined()

  expect(messages.replyTo('root', first.id)?.id).toBe(next!.request.messageId)
  expect(messages.replyTo('root', second.id)).toBeUndefined()
})

// Two queued inputs leave Q2 -> Q3 -> A2 -> A3; closing during A3 must resume Q3 in A3, not in A2.
it('continues a resumed input in its linked reply when an earlier reply sits below it', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const q2 = savedUser(f.reply.id, 'Second question')
  const q3 = savedUser(q2.id, 'Third question')
  const a2 = messages.saveMessage({
    sessionId: 'root',
    parentId: q3.id,
    message: { role: 'assistant', status: 'success', data: { parts: text('', 'Second answer').parts } }
  })
  const a3 = messages.saveMessage({
    sessionId: 'root',
    parentId: a2.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  messages.linkReply('root', [q2.id], a2.id)
  messages.linkReply('root', [q3.id], a3.id)

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: q3.id
  })
  await expect.poll(() => next).toBeDefined()

  expect(next!.request.messageId).toBe(a3.id)
  expect(messages.getSessionMessage('root', a2.id).status).toBe('success')
})

// AC6: the reply never reached terminal persistence; reopening rebuilds it from Durable's record.
it.each([
  { outcome: 'completed', status: 'success' },
  { outcome: 'aborted', status: 'paused' },
  { outcome: 'failed', status: 'error' }
] as const)('settles an unfinished reply from its Durable $outcome outcome on reopen', async ({ outcome, status }) => {
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const left = unsettledInput(f.reply.id)
  const terminals: Array<{ assistantMessageId: string; status: string }> = []
  f.service.onTurnTerminal((event) => terminals.push(event))

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(left.user.id),
      facts: ['accepted', 'placed'],
      outcome,
      ...(outcome === 'failed' && { error: { operation: 'run', code: 'provider-error', message: 'Provider failed' } })
    }
  })
  await f.project([left.native, text('answer', 'Recovered answer')], { live: [], inputs: left.inputs })

  const saved = messages.getSessionMessage('root', left.reply.id)
  expect(saved.status).toBe(status)
  expect(saved.data.parts?.[0]).toEqual(text('', 'Recovered answer').parts[0])
  if (status === 'error')
    expect(saved.data.parts).toContainEqual(
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: 'Provider failed' }) })
    )
  expect(terminals).toContainEqual(expect.objectContaining({ assistantMessageId: left.reply.id, status }))
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// Stop ends the background run that continued a finished input's reply, so that input's outcome is not the reply's.
it('keeps a reply paused when Stop ends its background continuation', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async () => {}, true, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('answer', 'First answer')])
  const completed: AgentRuntimeEvent = {
    type: 'input-state',
    contextId: f.context.id,
    input: { inputId: runtimeId(f.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
  }
  await f.emit(completed)
  await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
  await f.project([text('answer', 'First answer'), text('more', 'Background continuation')])
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const stopped = f.service.stopSession('root', 'user-requested')

  // Durable republishes every input on its next revision.
  await f.emit(completed)
  await f.emit({ type: 'turn-complete', status: 'paused' })
  await f.emit({ type: 'stop-confirmed' })
  await stopped

  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('paused')
})

// A truncated answer rebuilt on reopen must show the same output-limit card as a live turn.
it('keeps the output-limit classification for a truncated Durable outcome on reopen', async () => {
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const left = unsettledInput(f.reply.id)

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(left.user.id),
      facts: ['accepted', 'placed'],
      outcome: 'unanswered',
      error: { operation: 'run', code: 'output-truncated', message: 'Output limit reached' }
    }
  })
  await f.project([left.native, text('answer', 'Truncated answer')], { live: [], inputs: left.inputs })

  const saved = messages.getSessionMessage('root', left.reply.id)
  expect(saved.status).toBe('error')
  expect(saved.data.parts).toContainEqual(
    expect.objectContaining({
      type: 'data-error',
      data: expect.objectContaining({ finishReason: 'length', i18nKey: 'output_token_limit_reached' })
    })
  )
})

// The run completed natively before the user's Stop landed; the reply keeps Durable's outcome.
it.each(['before', 'after'] as const)(
  'replaces a paused reply with the Durable outcome reported %s Stop registers',
  async (reported) => {
    MockApplicationUtils.setService('AiStreamManager', {
      drainRuntimeReply: async () => {},
      pauseRuntimeTurn: () => false
    })
    const f = await fixture(async () => {}, true, 'pi-durable')
    const terminals: string[] = []
    f.service.onTurnTerminal((event) => void (event.assistantMessageId === f.reply.id && terminals.push(event.status)))
    const completed = () =>
      f.emit({
        type: 'input-state',
        contextId: f.context.id,
        input: { inputId: runtimeId(f.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
      })
    await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
    await f.project([text('answer', 'Partial answer')])
    await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
    if (reported === 'before') await completed()
    f.handle.abortController.abort('user-requested')
    const paused: StreamPausedResult = {
      status: 'paused',
      isTopicDone: true,
      finalMessage: (await f.done).finalMessage
    }
    await f.handle.listeners[0].onPaused(paused)
    await f.handle.listeners[1].onPaused(paused)

    await f.project([text('answer', 'Complete answer')], { live: [], refresh: ['answer'] })
    if (reported === 'after') await completed()
    await f.emit({ type: 'turn-complete' })
    await f.emit({ type: 'stop-confirmed' })

    await vi.waitFor(() =>
      expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
        status: 'success',
        data: { parts: text('', 'Complete answer').parts }
      })
    )
    // Deliveries finalize on the first terminal, so the paused one must not precede Durable's outcome.
    expect(terminals).toEqual(['success'])
  }
)

// The native interrupt waits on admission and child stops; a hang there must still end the Stop.
it('ends a retained Stop whose native interrupt never returns', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(() => new Promise<void>(() => {}), true)
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => void vi.useRealTimers())
  f.handle.abortController.abort('user-requested')
  let settled = false
  void f.service.stopSession('root', 'user-requested').then(
    () => (settled = true),
    () => (settled = true)
  )

  await vi.advanceTimersByTimeAsync(40_000)

  expect(settled).toBe(true)
  // The fallback closes the connection instead of waiting on a second stalled interrupt.
  expect(f.connections.closed).toBe(1)
  expect(f.service.isSessionBusy('root')).toBe(false)
  await f.reconnect()
  expect(f.connections.opened).toBe(2)
})

/** Streams the successor reply that the host launched for a placed input and persists it. */
async function answerSuccessor(f: Awaited<ReturnType<typeof fixture>>, next: StartRuntimeTurnInput, value: string) {
  const runtime = next.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const done = pipeMessageStream(
    source.stream,
    next.abortController!.signal,
    { id: next.request.messageId!, role: 'assistant', parts: [] },
    () => {},
    () => {}
  )
  await f.project([text('second', value)])
  await f.emit({ type: 'turn-complete' })
  await next.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })
  return messages.getSessionMessage('root', next.request.messageId!)
}

// AC4: busy-time input waits in Durable's queue, then gets its own reply once Durable places it.
it.each([
  { submitted: true, label: 'submitted in this process' },
  { submitted: false, label: 'queued before a restart' }
])('gives a Durable input $label its own reply when placed', async ({ submitted }) => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const followup = savedUser(f.reply.id, 'Second question')
  if (submitted) {
    f.service.enqueueUserMessage('root', followup, { followUp: true })
    expect(f.connections.followUps).toEqual([followup.id])
    expect(f.connections.steers).toEqual([])
  } else
    application.get('DbService').withWriteTx((tx) => messages.bindInputContextTx(tx, 'root', followup.id, f.context.id))
  expect(f.service.inspect('root')?.pendingMessageCount).toBe(0)

  await f.emit({ type: 'steer-boundary', inputIds: [followup.id] })
  const first = await f.done
  await f.handle.listeners[0].onDone({ status: 'success', finalMessage: first.finalMessage, isTopicDone: false })
  await f.handle.listeners[1].onDone({ status: 'success', finalMessage: first.finalMessage, isTopicDone: false })
  await expect.poll(() => next).toBeDefined()
  const second = await answerSuccessor(f, next!, 'Second answer')

  expect(second.data.parts).toEqual(text('', 'Second answer').parts)
  expect(messages.replyTo('root', followup.id)?.id).toBe(second.id)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// Durable answers each placement in its own run; one placed before the previous reply opens must not join it.
it('gives a Durable placement its own reply when it arrives before the previous one opens', async () => {
  const launched: StartRuntimeTurnInput[] = []
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => void launched.push(input)
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const second = savedUser(f.reply.id, 'Second question')
  const third = savedUser(second.id, 'Third question')
  f.service.enqueueUserMessage('root', second, { followUp: true })
  f.service.enqueueUserMessage('root', third, { followUp: true })

  await f.emit({ type: 'steer-boundary', inputIds: [second.id], followUp: true })
  await f.project([text('second', 'Second answer')])
  await f.emit({ type: 'steer-boundary', inputIds: [third.id], followUp: true })
  const first = await f.done
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  await expect.poll(() => launched).toHaveLength(1)
  const runtime = launched[0].request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: launched[0].abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  let streamed: Awaited<ReturnType<typeof pipeMessageStream>> | undefined
  void pipeMessageStream(
    source.stream,
    launched[0].abortController!.signal,
    { id: launched[0].request.messageId!, role: 'assistant', parts: [] },
    () => {},
    () => {}
  ).then((value) => (streamed = value))
  // The third placement ends this reply once its stream has taken the buffered answer.
  await expect.poll(() => streamed).toBeDefined()
  const handoff: StreamDoneResult = { status: 'success', finalMessage: streamed!.finalMessage, isTopicDone: false }
  for (const listener of launched[0].listeners) await listener.onDone(handoff)
  await expect.poll(() => launched).toHaveLength(2)

  expect(launched.map((input) => input.request.messages?.[0]?.id)).toEqual([second.id, third.id])
  expect(launched[1].request.messageId).not.toBe(launched[0].request.messageId)
  expect(messages.getSessionMessage('root', launched[0].request.messageId!).data.parts).toEqual(
    text('', 'Second answer').parts
  )
})

// Durable reports an answer's outcome only when the run ends, after the follow-up placed behind it.
it('saves a truncated answer as an output-limit error after its follow-up was placed', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: () => {},
    drainRuntimeReply: async () => {}
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const followup = savedUser(f.reply.id, 'Second question')
  f.service.enqueueUserMessage('root', followup, { followUp: true })
  await f.emit({ type: 'steer-boundary', inputIds: [followup.id], followUp: true })
  const first = await f.done
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(f.user.id),
      facts: ['accepted', 'placed'],
      outcome: 'unanswered',
      error: { operation: 'input', code: 'output-truncated', message: 'Output limit reached' }
    }
  })

  await vi.waitFor(() => expect(messages.getSessionMessage('root', f.reply.id).status).toBe('error'))
  const saved = messages.getSessionMessage('root', f.reply.id)
  expect(saved.data.parts).toEqual([
    ...text('', 'First answer').parts,
    expect.objectContaining({
      type: 'data-error',
      data: expect.objectContaining({ finishReason: 'length', i18nKey: 'output_token_limit_reached' })
    })
  ])
})

// AC4 Stop: Durable withdraws input still queued; the transcript must not show it as sent.
it('marks a queued Durable input that Stop withdrew as not sent', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async () => {}, true, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('answer', 'Partial answer')])
  const queued = savedUser(f.reply.id, 'Queued question')
  f.service.enqueueUserMessage('root', queued, { followUp: true })
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const stopped = f.service.stopSession('root', 'user-requested')

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(queued.id),
      facts: ['accepted', 'queued'],
      outcome: 'aborted',
      error: { operation: 'input', code: 'aborted', message: 'aborted' }
    }
  })
  await f.emit({ type: 'turn-complete', status: 'paused' })
  await f.emit({ type: 'stop-confirmed' })
  await stopped

  expect(messages.getSessionMessage('root', queued.id).status).toBe('paused')
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('paused')
})

// AC4: a queued input that starts native work on its own has no reply to continue yet.
it('opens a new reply when a queued Durable input starts native work', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const queued = savedUser(f.reply.id, 'Queued before exit')
  application.get('DbService').withWriteTx((tx) => messages.bindInputContextTx(tx, 'root', queued.id, f.context.id))

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: queued.id
  })
  await expect.poll(() => next).toBeDefined()
  const reply = await answerSuccessor(f, next!, 'Queued answer')

  expect(reply.data.parts).toEqual(text('', 'Queued answer').parts)
  expect(messages.replyTo('root', queued.id)?.id).toBe(reply.id)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// The native successor can publish before the preceding reply has committed and created its row.
it('retains a reserved steer reply until its stream takes ownership', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture()
  await f.project([text('first', 'Original answer')])
  const followup = messages.saveMessage({
    sessionId: 'root',
    parentId: f.reply.id,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Revised requirement' }] } }
  })
  f.service.enqueueUserMessage('root', followup)
  await f.emit({ type: 'steer-boundary', inputIds: [followup.id] })
  const first = await f.done
  await f.project([text('second', 'Continuation before handoff')])
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  await expect.poll(() => next).toBeDefined()
  const runtime = next!.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected continuation runtime')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next!.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const views: CherryUIMessage[] = []
  const done = pipeMessageStream(
    source.stream,
    next!.abortController!.signal,
    { id: next!.request.messageId!, role: 'assistant', parts: [] },
    (message) => views.push(message),
    () => {}
  )
  await vi.waitFor(() => expect(views.at(-1)?.parts).toEqual(text('', 'Continuation before handoff').parts))
  await f.emit({ type: 'turn-complete' })
  await next!.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'Original answer').parts)
  expect(messages.getSessionMessage('root', next!.request.messageId!).data.parts).toEqual(
    text('', 'Continuation before handoff').parts
  )
})

// A closed stream's snapshot must not overwrite updates arriving before the synchronous DB commit.
it('hands late source changes from an open stream to terminal persistence and idle history', async () => {
  const naming = Promise.withResolvers<void>()
  const rename = vi.spyOn(topicNamingService, 'maybeRenameAgentSession').mockReturnValue(naming.promise)
  onTestFinished(() => naming.resolve())
  const f = await fixture()
  await f.project([text('a', 'A'), text('b', 'B')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toHaveLength(2))
  await f.emit({ type: 'turn-complete' })
  const streamed = await f.done
  await f.project([text('b', 'B before commit')], { live: [], refresh: ['b'], removed: ['a'] })
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('pending')
  const result: StreamDoneResult = { status: 'success', finalMessage: streamed.finalMessage }
  const persistence = f.handle.listeners[0].onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B before commit').parts)
  await f.project([text('b', 'B after commit')], { live: [], refresh: ['b'] })
  await persistence
  expect(rename).toHaveBeenCalledOnce()
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B after commit').parts)
  await f.handle.listeners[1].onDone(result)
  expect(f.service.inspect('root')?.status).toBe('idle')
  await f.reconnect()
  await f.project([text('b', 'B after reconnect')], { live: [], refresh: ['b'] })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B after reconnect').parts)
  await f.project([], { removed: ['b'] })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([])
  const restored = new RootMessageProjection(f.context.id)
  expect(
    restored.accept(
      { contextId: f.context.id, messages: [text('b', 'stale')], live: ['b'], removed: [], replaces: {} },
      f.reply.id
    ).size
  ).toBe(0)
})

// ExitPlanMode can supply display input before native content; a completed native card must stay withdrawn.
it.each(['output-available', 'output-denied'] as const)(
  'does not resurrect a withdrawn %s plan card',
  async (state) => {
    const f = await fixture()
    const sessionState = new ClaudeCodeSessionStateService()
    MockApplicationUtils.setService('ClaudeCodeSessionStateService', sessionState)
    const input = { plan: 'Inspect the module, then implement the fix.' }
    const holder = sessionState.getToolApprovalEmitterHolder('root')
    let inputDelivered = Promise.resolve()
    holder.emitInput = (value) => {
      inputDelivered = f.emit({ type: 'chunk', chunk: { type: 'tool-input-available', ...value, dynamic: true } })
    }
    surfaceExitPlanModeInput('root', 'ExitPlanMode', input, 'plan')
    await inputDelivered
    await f.emit({
      type: 'chunk',
      chunk: { type: 'tool-approval-request', toolCallId: 'plan', approvalId: 'approval' }
    })
    await vi.waitFor(() =>
      expect(f.views.at(-1)?.parts).toContainEqual(
        expect.objectContaining({ toolCallId: 'plan', input, state: 'approval-requested' })
      )
    )
    const call = { type: 'dynamic-tool' as const, toolCallId: 'plan', toolName: 'ExitPlanMode', input }
    const settled: CherryUIMessage['parts'][number] =
      state === 'output-available'
        ? { ...call, state, output: 'Plan accepted' }
        : { ...call, state, approval: { id: 'approval', approved: false } }
    await f.project([{ id: 'native', role: 'assistant', parts: [settled] }])
    await f.project([], { removed: ['native'] })
    await f.emit({ type: 'turn-complete' })
    expect((await f.done).finalMessage?.parts).toEqual([])
  }
)

// Native terminal messages omit host approvals; replay must not erase the user's decision.
it.each([false, true])('retains approval=%s through native results, persistence and reconnect', async (approved) => {
  const f = await fixture()
  const toolCallId = 'write-result'
  const approvalId = 'host-write-approval'
  const input = { path: '/test/result.txt', content: 'owned' }
  const call = { type: 'dynamic-tool' as const, toolCallId, toolName: 'write', input }
  await f.project([{ id: 'native-write', role: 'assistant', parts: [{ ...call, state: 'input-available' }] }])
  await f.emit({ type: 'chunk', chunk: { type: 'tool-input-available', toolCallId, toolName: 'write', input } })
  await f.emit({ type: 'chunk', chunk: { type: 'tool-approval-request', toolCallId, approvalId } })
  MockApplicationUtils.setService('AiStreamManager', { resolveToolApproval: () => {} })
  const decision = Promise.withResolvers<{ approved: boolean }>()
  toolApprovalRegistry.register({
    sessionId: 'root',
    toolCallId,
    toolName: 'write',
    originalInput: input,
    approvalId,
    resolve: decision.resolve
  })
  onTestFinished(() => {
    toolApprovalRegistry.clear()
  })
  expect(f.service.respondToolApproval(approvalId, { approved })).toEqual({ ok: true })
  expect(await decision.promise).toMatchObject({ approved })
  const native: CherryUIMessage = {
    id: 'native-write',
    role: 'assistant',
    parts: [{ ...call, state: 'output-error', errorText: approved ? 'Disk full' : 'Tool blocked' }]
  }
  await f.project([native])
  const expected = approved
    ? { ...call, state: 'output-error', errorText: 'Disk full', approval: { id: approvalId, approved } }
    : { ...call, state: 'output-denied', approval: { id: approvalId, approved } }
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual([expected]))
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([expected])
  const restored = new RootMessageProjection(f.context.id)
  restored.accept({
    contextId: f.context.id,
    messages: [native],
    live: [],
    refresh: [native.id],
    replaces: {},
    removed: []
  })
  expect(restored.parts(f.reply.id)).toEqual([expected])
})
