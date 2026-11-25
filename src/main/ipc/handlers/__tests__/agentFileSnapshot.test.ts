import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { linkSessionMessageChain, seedSessionRoot, setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { AgentFileSnapshotService } from '@main/ai/agentSession/AgentFileSnapshotService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { agentHandlers } from '../agent'

vi.mock('@application', async () => (await import('@test-mocks/main/application')).mockApplicationFactory())

const round = { sessionId: 'session', replyId: 'A', inputMessageIds: ['input'] }
const ctx = { senderId: null }
let dir: string
let target: string
let snapshots: AgentFileSnapshotService
let attested: string | null
const dbh = setupTestDatabase()

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-ipc-'))
  const cwd = path.join(dir, 'workspace')
  await mkdir(cwd)
  target = path.join(cwd, 'file')
  await writeFile(target, 'baseline')
  vi.spyOn(application, 'getPath').mockImplementation((key) =>
    key === 'feature.agents.file_snapshots' ? path.join(dir, 'snapshots') : path.join(dir, key)
  )
  BaseService.resetInstances()
  snapshots = new AgentFileSnapshotService()
  await snapshots.admitRound(round)
  const attempt = await snapshots.protectWrite({
    round,
    callId: 'write',
    runtime: 'pi',
    toolName: 'write',
    filePath: target,
    cwd,
    intent: { toolName: 'write', input: { content: 'agent' } }
  })
  await writeFile(target, 'agent')
  await snapshots.settleWrite({ round, attemptId: attempt.attemptId!, outcome: 'success' })
  await snapshots.markRoundFinished(round.sessionId, round.replyId)
  attested = null
  MockApplicationUtils.setService('AgentFileSnapshotService', snapshots)
  MockApplicationUtils.setService('AgentSessionRuntimeService', { attestSnapshotRound: () => attested })
})

afterEach(async () => {
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  BaseService.resetInstances()
  await rm(dir, { recursive: true, force: true })
})

it.each([null, 'B'] as const)('requires runtime attestation %s at both IPC endpoints', async (current) => {
  attested = current
  const manifest = path.join(dir, 'snapshots/session/A/manifest.json')
  const diskCurrent = path.join(dir, 'snapshots/session/current.json')
  const beforeManifest = await readFile(manifest)
  const beforeCurrent = await readFile(diskCurrent)
  expect(await agentHandlers['agent.file_snapshot.state']({ sessionId: 'session' }, ctx)).toMatchObject({
    canUndo: false,
    reason: 'stale'
  })
  expect(
    await agentHandlers['agent.file_snapshot.undo']({ sessionId: 'session', replyId: 'A', expectedRevision: '1' }, ctx)
  ).toMatchObject({ reason: 'stale', files: [] })
  expect(await readFile(manifest)).toEqual(beforeManifest)
  expect(await readFile(diskCurrent)).toEqual(beforeCurrent)
  expect(await readFile(target, 'utf8')).toBe('agent')
  attested = 'A'
  const state = await agentHandlers['agent.file_snapshot.state']({ sessionId: 'session' }, ctx)
  expect(state).toMatchObject({ canUndo: true, reason: null })
  expect(
    await agentHandlers['agent.file_snapshot.undo'](
      { sessionId: 'session', replyId: 'A', expectedRevision: state.revision! },
      ctx
    )
  ).toMatchObject({ reason: null, files: [{ status: 'restored' }] })
  expect(await readFile(target, 'utf8')).toBe('baseline')
})

it.each(['restart', 'different-reply', 'new-live-reply'] as const)(
  'attests the persisted session through IPC: %s',
  async (scenario) => {
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', type: 'user', path: path.dirname(target), name: 'Workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    const parentId = seedSessionRoot(dbh.db, 'session')
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: scenario === 'different-reply' ? 'B' : 'A',
        sessionId: 'session',
        parentId,
        role: 'assistant',
        status: 'success',
        data: { parts: [] }
      })
      .run()
    linkSessionMessageChain(dbh.db, 'session', [scenario === 'different-reply' ? 'B' : 'A'])
    const runtime = new AgentSessionRuntimeService()
    if (scenario === 'new-live-reply')
      (runtime as unknown as { snapshotRounds: Map<string, string> }).snapshotRounds.set('session', 'B')
    MockApplicationUtils.setService('AgentSessionRuntimeService', runtime)
    const state = await agentHandlers['agent.file_snapshot.state']({ sessionId: 'session' }, ctx)
    if (scenario === 'restart') {
      expect(state).toMatchObject({ canUndo: true, reason: null })
      expect(
        await agentHandlers['agent.file_snapshot.undo'](
          { sessionId: 'session', replyId: 'A', expectedRevision: state.revision! },
          ctx
        )
      ).toMatchObject({ reason: null, files: [{ status: 'restored' }] })
      expect(await readFile(target, 'utf8')).toBe('baseline')
    } else {
      expect(state).toMatchObject({ canUndo: false, reason: 'stale' })
      expect(
        await agentHandlers['agent.file_snapshot.undo'](
          { sessionId: 'session', replyId: 'A', expectedRevision: '1' },
          ctx
        )
      ).toMatchObject({ reason: 'stale', files: [] })
      expect(await readFile(target, 'utf8')).toBe('agent')
    }
  }
)

it.each(['success', 'retry succeeds', 'retry fails'] as const)(
  'revokes undo after workspace deletion when snapshot cleanup %s',
  async (scenario) => {
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', type: 'user', path: path.dirname(target), name: 'Workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    const parentId = seedSessionRoot(dbh.db, 'session')
    dbh.db
      .insert(agentSessionMessageTable)
      .values({ id: 'A', sessionId: 'session', parentId, role: 'assistant', status: 'success', data: { parts: [] } })
      .run()
    linkSessionMessageChain(dbh.db, 'session', ['A'])
    const runtime = new AgentSessionRuntimeService()
    vi.spyOn(runtime, 'cancelSessionForks').mockResolvedValue(undefined)
    vi.spyOn(runtime, 'closeSession').mockResolvedValue(undefined)
    vi.spyOn(runtime, 'recoverSessionForks').mockResolvedValue(undefined)
    MockApplicationUtils.setService('AgentSessionRuntimeService', runtime)
    MockApplicationUtils.setService('AiStreamManager', { abortAndDrain: async () => {} })
    MockApplicationUtils.setService('AgentSessionDeliveryService', {
      drainSessionQueues: async () => {},
      kick: () => {}
    })
    const lifecycle = new AgentLifecycleService()
    const before = await readFile(target)
    const state = await agentHandlers['agent.file_snapshot.state']({ sessionId: 'session' }, ctx)
    expect(state.canUndo).toBe(true)
    const purge = vi.spyOn(snapshots, 'purgeSessions')
    if (scenario !== 'success') purge.mockRejectedValueOnce(new Error('cleanup failed'))
    if (scenario === 'retry fails') purge.mockRejectedValueOnce(new Error('retry failed'))
    await lifecycle.deleteWorkspace('workspace')
    expect(
      await agentHandlers['agent.file_snapshot.undo'](
        { sessionId: 'session', replyId: 'A', expectedRevision: state.revision! },
        ctx
      )
    ).toMatchObject({ reason: 'stale', files: [] })
    expect(await readFile(target)).toEqual(before)
    const pending = (lifecycle as unknown as { pendingSnapshotPurges: Set<string> }).pendingSnapshotPurges
    if (scenario !== 'success') {
      expect(pending.has('session')).toBe(true)
      await lifecycle.sweepOrphans()
      if (scenario === 'retry fails') {
        expect(pending.has('session')).toBe(true)
        expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
          'Failed to remove purged Agent Session snapshots',
          expect.objectContaining({ sessionId: 'session' })
        )
        await lifecycle.sweepOrphans()
      }
      expect(pending.has('session')).toBe(false)
    }
    await expect(stat(path.join(dir, 'snapshots/session'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(target)).toEqual(before)
  }
)
