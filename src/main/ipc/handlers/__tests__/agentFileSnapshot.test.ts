import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { AgentFileSnapshotService } from '@main/ai/agentSession/AgentFileSnapshotService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { agentHandlers } from '../agent'

vi.mock('@application', async () => (await import('@test-mocks/main/application')).mockApplicationFactory())

const round = { sessionId: 'session', replyId: 'A', inputMessageIds: ['input'] }
const ctx = { senderId: null }
let dir: string
let target: string
let snapshots: AgentFileSnapshotService
let attested: string | null

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'snapshot-ipc-'))
  const cwd = path.join(dir, 'workspace')
  await mkdir(cwd)
  target = path.join(cwd, 'file')
  await writeFile(target, 'baseline')
  vi.spyOn(application, 'getPath').mockReturnValue(path.join(dir, 'snapshots'))
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
