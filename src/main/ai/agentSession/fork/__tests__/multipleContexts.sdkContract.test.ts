import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { RuntimeForkAnchorSchema, type RuntimeForkInput } from '@main/ai/runtime/fork'
import { PiForkCheckpointSchema } from '@main/ai/runtime/pi/forkCheckpoint'
import { preparePiBranch, reservePiBranchTx } from '@main/ai/runtime/pi/piContext'
import { forkPiSession } from '@main/ai/runtime/pi/piFork'
import { resolveResumeTokenSessionFile } from '@main/ai/runtime/pi/piSessionFile'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { AgentSessionForkOperations } from '../AgentSessionForkOperations'
import { readForkResources } from '../resources'

const dbh = setupTestDatabase()
let directory: string
let sessions: string
let sessionId: string
let boundary: ReturnType<typeof messages.saveMessage>
let oldNative: SessionManager
let currentNative: SessionManager
let beforeFork: (input: RuntimeForkInput) => void | Promise<void>
const previous = runtimeDriverRegistry.getAgentSessionDriver('pi')

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fork-contexts-'))
  sessions = path.join(directory, 'sessions')
  await mkdir(sessions)
  beforeFork = () => {}
  const original = application.getPath.bind(application)
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
    if (key === 'feature.agents.pi.sessions') return path.join(sessions, filename ?? '')
    if (key === 'feature.agents.forks') return path.join(directory, 'forks', filename ?? '')
    return original(key, filename)
  })
  const agentId = randomUUID()
  const workspaceId = randomUUID()
  sessionId = randomUUID()
  dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Pi', instructions: '', orderKey: 'a0' }).run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, type: 'user', name: 'Work', path: directory, orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: sessionId, agentId, workspaceId, name: 'Contexts', orderKey: 'a0' })
    .run()
  runtimeDriverRegistry.register({
    type: 'pi',
    validateSession() {},
    isForkCheckpoint: (value) => PiForkCheckpointSchema.safeParse(value).success,
    async connect() {
      throw new Error('History operations must not run a model')
    },
    async fork(input) {
      await beforeFork(input)
      return forkPiSession(input)
    }
  })
  oldNative = SessionManager.create(directory, sessions)
  preparePiBranch(sessionId, undefined, oldNative.getSessionId())
  const initial = input('OLD_CONTEXT_ONLY', oldNative)
  messages.setEditRuntimeTx(dbh.db, sessionId, initial.id, oldNative.getSessionId())
  answer('First answer', oldNative)
  input('Old second question', oldNative)
  answer('Old second answer', oldNative)
  currentNative = SessionManager.create(directory, sessions)
  const next = input('CURRENT_CONTEXT_ONLY', currentNative)
  reservePiBranchTx(dbh.db, sessionId, next.id, currentNative.getSessionId())
  answer('Current answer', currentNative)
  input('Selected question', currentNative)
  boundary = answer('Selected answer', currentNative)
})

afterEach(async () => {
  dbh.sqlite.exec('DROP TRIGGER IF EXISTS reject_cloned_context')
  runtimeDriverRegistry.clearForTest()
  if (previous) runtimeDriverRegistry.register(previous)
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function input(text: string, native: SessionManager, target = sessionId) {
  native.appendMessage({ role: 'user', content: text, timestamp: Date.now() })
  return messages.saveMessage({
    sessionId: target,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
  })
}

function answer(text: string, native: SessionManager, target = sessionId) {
  native.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'fixture',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  })
  return messages.saveMessage({
    sessionId: target,
    runtimeResumeToken: native.getSessionId(),
    nativeContextId: preparePiBranch(target, messages.captureHead(target) ?? undefined, native.getSessionId()).id,
    runtimeAnchor: {
      checkpoint: { runtime: 'pi', runtimeSessionId: native.getSessionId(), leafId: native.getLeafId() }
    },
    message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
  })
}

function checkpoint(target: string, messageId: string) {
  const row = messages.readForkPrefixTx(dbh.db, target, messageId)!.at(-1)!
  return PiForkCheckpointSchema.parse(RuntimeForkAnchorSchema.parse(row.data.runtimeAnchor).checkpoint)
}

it('keeps both histories independent after source removal and can fork either copied segment', async () => {
  const child = await new AgentSessionForkOperations().fork(sessionId, boundary.id)
  const rows = messages.listSessionMessages(child).items.toReversed()
  expect(rows.map((row) => row.data.parts?.[0])).toEqual(
    messages
      .listSessionMessages(sessionId)
      .items.toReversed()
      .map((row) => row.data.parts?.[0])
  )
  const firstCopy = rows[1]
  const lastCopy = rows.at(-1)!
  const old = checkpoint(child, firstCopy.id)
  const current = checkpoint(child, lastCopy.id)
  expect(old.runtimeSessionId).not.toBe(oldNative.getSessionId())
  expect(current.runtimeSessionId).not.toBe(currentNative.getSessionId())
  expect(old.runtimeSessionId).not.toBe(current.runtimeSessionId)
  const bindings = dbh.db
    .select()
    .from(agentSessionContextTable)
    .where(eq(agentSessionContextTable.sessionId, child))
    .all()
  expect(new Set(bindings.map((row) => row.nativeThreadId))).toEqual(
    new Set([old.runtimeSessionId, current.runtimeSessionId])
  )
  expect(bindings.every((row) => row.bindingState === 'bound')).toBe(true)
  expect(messages.getNativeSessionId(child)).toBe(current.runtimeSessionId)
  expect(
    agentSessionContextService.branchTx(
      dbh.db,
      child,
      rows.find((row) => row.data.parts?.some((part) => part.type === 'text' && part.text === 'CURRENT_CONTEXT_ONLY'))!
        .id
    )?.nativeThreadId
  ).toBe(current.runtimeSessionId)
  const native = SessionManager.open(resolveResumeTokenSessionFile(current.runtimeSessionId, sessions)!, sessions)
  expect(JSON.stringify(native.getBranch())).toContain('CURRENT_CONTEXT_ONLY')
  expect(JSON.stringify(native.getBranch())).not.toContain('OLD_CONTEXT_ONLY')
  dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).run()
  await rm(oldNative.getSessionFile()!)
  await rm(currentNative.getSessionFile()!)
  const olderFork = await new AgentSessionForkOperations().fork(child, firstCopy.id)
  const laterFork = await new AgentSessionForkOperations().fork(child, lastCopy.id)
  expect(messages.listSessionMessages(olderFork).items).toHaveLength(2)
  expect(messages.listSessionMessages(laterFork).items).toHaveLength(8)
  expect(checkpoint(olderFork, messages.listSessionMessages(olderFork).items[0].id).runtimeSessionId).not.toBe(
    old.runtimeSessionId
  )
  expect(checkpoint(laterFork, messages.listSessionMessages(laterFork).items[0].id).runtimeSessionId).not.toBe(
    current.runtimeSessionId
  )
  expect(
    messages
      .listSessionMessages(child)
      .items.toReversed()
      .map((row) => row.id)
  ).toEqual(rows.map((row) => row.id))
})

it('edits the later context without sending earlier checkpoints to its adapter or rewriting the earlier context', async () => {
  const child = await new AgentSessionForkOperations().fork(sessionId, boundary.id)
  const rows = messages.listSessionMessages(child).items.toReversed()
  const old = checkpoint(child, rows[1].id)
  const user = rows.find((row) =>
    row.data.parts?.some((part) => part.type === 'text' && part.text === 'Selected question')
  )!
  const target = { messageId: user.id, version: messages.readEditSnapshotTx(dbh.db, child, user.id).version }
  const replacement = await new AgentSessionForkOperations().edit(
    child,
    target,
    async () => {},
    (tx, nativeId) => {
      const [saved] = messages.saveMessagesTx(tx, {
        sessionId: child,
        messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Edited question' }] } }]
      })
      reservePiBranchTx(tx, child, saved.id, nativeId)
      messages.setEditRuntimeTx(tx, child, saved.id, nativeId)
      return saved.id
    }
  )
  expect(checkpoint(child, rows[1].id)).toEqual(old)
  const editedNative = messages.getNativeSessionId(child)!
  const manager = SessionManager.open(resolveResumeTokenSessionFile(editedNative, sessions)!, sessions)
  expect(JSON.stringify(manager.getBranch())).not.toContain('OLD_CONTEXT_ONLY')
  expect(JSON.stringify(manager.getBranch())).not.toContain('Selected answer')
  manager.appendMessage({ role: 'user', content: 'Edited question', timestamp: Date.now() })
  const editedReply = answer('Edited answer', manager, child)
  const next = await new AgentSessionForkOperations().fork(child, editedReply.id)
  expect(messages.listSessionMessages(next).items).toHaveLength(8)
  expect(messages.getNativeSessionId(child, replacement)).toBe(editedNative)
})

it.each(['preparation', 'bindings changed', 'publication'] as const)(
  'publishes nothing and removes all prepared artifacts on %s failure',
  async (failure) => {
    const files = await readdir(sessions)
    if (failure === 'publication')
      dbh.sqlite.exec(
        `CREATE TRIGGER reject_cloned_context BEFORE INSERT ON agent_session_context WHEN NEW.session_id != '${sessionId}' BEGIN SELECT RAISE(ABORT, 'context publish failed'); END`
      )
    let count = 0
    beforeFork = () => {
      if (++count !== 2) return
      if (failure === 'preparation') throw new Error('second context failed')
      if (failure === 'publication') return
      dbh.db
        .update(agentSessionContextTable)
        .set({ checkpointMapping: { fork: {} } })
        .where(eq(agentSessionContextTable.sessionId, sessionId))
        .run()
    }
    await expect(new AgentSessionForkOperations().fork(sessionId, boundary.id)).rejects.toMatchObject(
      failure === 'preparation'
        ? { message: 'second context failed' }
        : failure === 'publication'
          ? { message: 'context publish failed' }
          : { reason: 'source_changed' }
    )
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((row) => row.id)
    ).toEqual([sessionId])
    expect(await readdir(sessions)).toEqual(files)
    expect(await readForkResources()).toEqual([])
  }
)

it('edits an earlier copied segment after the original native files have been removed', async () => {
  const child = await new AgentSessionForkOperations().fork(sessionId, boundary.id)
  dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).run()
  await rm(oldNative.getSessionFile()!)
  await rm(currentNative.getSessionFile()!)
  const rows = messages.listSessionMessages(child).items
  const user = rows.find((row) =>
    row.data.parts?.some((part) => part.type === 'text' && part.text === 'Old second question')
  )!
  const target = { messageId: user.id, version: messages.readEditSnapshotTx(dbh.db, child, user.id).version }
  await new AgentSessionForkOperations().edit(
    child,
    target,
    async () => {},
    (tx, nativeId) => {
      const [saved] = messages.saveMessagesTx(tx, {
        sessionId: child,
        messages: [
          { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Old segment replacement' }] } }
        ]
      })
      reservePiBranchTx(tx, child, saved.id, nativeId)
      messages.setEditRuntimeTx(tx, child, saved.id, nativeId)
    }
  )
  const id = messages.getNativeSessionId(child)!
  const native = SessionManager.open(resolveResumeTokenSessionFile(id, sessions)!, sessions)
  expect(JSON.stringify(native.getBranch())).toContain('OLD_CONTEXT_ONLY')
  expect(JSON.stringify(native.getBranch())).not.toContain('CURRENT_CONTEXT_ONLY')
  expect(JSON.stringify(native.getBranch())).not.toContain('Old second answer')
  expect(messages.listSessionMessages(child).items.map((row) => row.role)).toEqual(['user', 'assistant', 'user'])
})
