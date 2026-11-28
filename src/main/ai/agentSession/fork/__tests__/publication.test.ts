import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq, ne } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { replaceAgentSessionMessagePartsTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { RuntimeForkInput, RuntimeForkResult } from '@main/ai/runtime/fork'
import { PiForkCheckpointSchema } from '@main/ai/runtime/pi/forkCheckpoint'
import { preparePiBranch, reservePiBranchTx } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import * as fileUtils from '@main/utils/file'

import { AgentSessionForkOperations } from '../AgentSessionForkOperations'
import { readForkResources, writeForkResources } from '../resources'

// Catch publication without durable file ownership, partial DB commits and cleanup of a live fork.
describe('Agent fork publication', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let forkRoot: string
  let sessionId: string
  let messageId: string
  let publishedFile: string
  let beforeForkResult: (input: RuntimeForkInput) => Promise<void>
  let invalidCheckpoint: boolean
  let artifactSourceFor: (artifactDirectory: string) => string
  let previous: ReturnType<typeof runtimeDriverRegistry.getAgentSessionDriver>

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'fork-publication-'))
    forkRoot = path.join(directory, 'forks')
    publishedFile = path.join(directory, 'native', 'child.jsonl')
    beforeForkResult = async () => {}
    invalidCheckpoint = false
    artifactSourceFor = (artifactDirectory) => path.join(artifactDirectory, 'native.jsonl')
    vi.spyOn(application, 'getPath').mockImplementation((_key, filename) =>
      filename ? path.join(forkRoot, filename) : forkRoot
    )
    const agentId = randomUUID()
    const workspaceId = randomUUID()
    sessionId = randomUUID()
    messageId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Workspace', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId, workspaceId, name: 'Source', orderKey: 'a0' })
      .run()
    agentSessionMessageService.saveMessage({
      sessionId,
      runtimeResumeToken: 'native-parent',
      nativeContextId: preparePiBranch(sessionId, undefined, 'native-parent').id,
      runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native-parent', leafId: 'leaf' } },
      message: {
        id: messageId,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Preserved answer' }] }
      }
    })
    previous = runtimeDriverRegistry.getAgentSessionDriver('pi')
    runtimeDriverRegistry.register({
      type: 'pi',
      isForkCheckpoint: (value) => PiForkCheckpointSchema.safeParse(value).success,
      validateSession() {},
      async connect() {
        throw new Error('Fork must not start a conversation')
      },
      async fork(input): Promise<RuntimeForkResult> {
        const source = artifactSourceFor(input.artifactDirectory)
        await mkdir(path.dirname(source), { recursive: true })
        await writeFile(source, 'native child history')
        await beforeForkResult(input)
        return {
          resumeToken: 'native-child',
          publish: [{ source, target: publishedFile }],
          checkpoints: input.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            runtime: invalidCheckpoint ? '' : checkpoint.runtime,
            runtimeSessionId: 'native-child'
          }))
        }
      }
    })
  })

  afterEach(async () => {
    dbh.sqlite.exec('DROP TRIGGER IF EXISTS reject_fork_messages')
    runtimeDriverRegistry.clearForTest()
    if (previous) runtimeDriverRegistry.register(previous)
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects unsupported runtimes without blaming missing checkpoints or changing history', async () => {
    const driver = runtimeDriverRegistry.getAgentSessionDriver('pi')!
    runtimeDriverRegistry.register({ ...driver, fork: undefined })
    agentSessionMessageService.saveMessage({
      sessionId,
      message: {
        id: messageId,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Answer without a checkpoint' }] }
      }
    })
    const user = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Question' }] } }
    })
    const before = agentSessionMessageService.listSessionMessages(sessionId).items
    const operations = new AgentSessionForkOperations()
    await expect(operations.fork(sessionId, messageId)).rejects.toMatchObject({ reason: 'runtime_unsupported' })
    const target = {
      messageId: user.id,
      version: agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, user.id).version
    }
    await expect(
      operations.edit(
        sessionId,
        target,
        async () => {
          throw new Error('Must not close the source')
        },
        () => {
          throw new Error('Must not rewrite history')
        }
      )
    ).rejects.toMatchObject({ reason: 'runtime_unsupported' })
    expect(agentSessionMessageService.listSessionMessages(sessionId).items).toEqual(before)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })

  it.each(['commit', 'write failed', 'withdrawn'])(
    'edits queued C from Run B without removing the earlier completed Run: %s',
    async (outcome) => {
      const root = dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.id, messageId))
        .get()!.parentId!
      const input = (text: string, parentId: string) =>
        agentSessionMessageService.saveMessage({
          sessionId,
          parentId,
          message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
        })
      const a = input('A', root)
      const b = input('B', messageId)
      const steer = input('S', b.id)
      const withdrawn = outcome === 'withdrawn' ? input('Withdrawn Q', steer.id) : undefined
      if (withdrawn) {
        const context = agentSessionContextService.branchTx(dbh.db, sessionId, steer.id)!
        dbh.db
          .update(agentSessionMessageTable)
          .set({ inputContextId: context.id, status: 'paused' })
          .where(eq(agentSessionMessageTable.id, withdrawn.id))
          .run()
      }
      const c = input('C', withdrawn?.id ?? steer.id)
      dbh.db
        .update(agentSessionMessageTable)
        .set({ parentId: a.id })
        .where(eq(agentSessionMessageTable.id, messageId))
        .run()
      const reply = (text: string, parentId: string) =>
        agentSessionMessageService.saveMessage({
          sessionId,
          parentId,
          runtimeResumeToken: 'native-parent',
          runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native-parent', leafId: text } },
          message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
        })
      const rb = reply('B reply', c.id)
      const rc = reply('C reply', rb.id)
      const sibling = input('Independent sibling', rb.id)
      for (const [row, pos, owner] of [
        [a, 1, messageId],
        [steer, 2, messageId],
        [b, 3, rb.id],
        [c, 4, rc.id]
      ] as const) {
        dbh.db
          .update(agentSessionMessageTable)
          .set({ pos, replyId: owner })
          .where(eq(agentSessionMessageTable.id, row.id))
          .run()
      }
      dbh.db.update(agentSessionTable).set({ activeNodeId: rc.id }).where(eq(agentSessionTable.id, sessionId)).run()
      beforeForkResult = async (input) => {
        expect(input.checkpoint).toMatchObject({ leafId: 'B reply' })
      }
      const version = agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, c.id).version
      const before = dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, sessionId))
        .all()
      const operation = new AgentSessionForkOperations().edit(
        sessionId,
        { messageId: c.id, version },
        async () => {},
        (tx, nativeSessionId) => {
          const saved = agentSessionMessageService.saveMessagesTx(tx, {
            sessionId,
            messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Edited C' }] } }]
          })[0]
          reservePiBranchTx(tx, sessionId, saved.id, nativeSessionId)
          if (outcome === 'write failed') throw new Error('write failed')
          return saved.id
        }
      )
      if (outcome === 'write failed') {
        await expect(operation).rejects.toThrow('write failed')
        expect(
          dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, sessionId)).all()
        ).toEqual(before)
        return
      }
      const next = await operation
      const kept = agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, next).prefix
      expect(agentSessionMessageService.getSessionMessage(sessionId, sibling.id).data.parts).toEqual([
        { type: 'text', text: 'Independent sibling' }
      ])
      expect(kept.map((row) => row.id)).toEqual([a.id, messageId, steer.id, b.id, rb.id])
      expect(agentSessionMessageService.getSessionMessage(sessionId, b.id).replyId).toBe(rb.id)
      expect(agentSessionMessageService.getSessionMessage(sessionId, rb.id).data.parts).toEqual([
        { type: 'text', text: 'B reply' }
      ])
      expect(
        dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, rc.id)).get()
      ).toBeUndefined()
    }
  )

  it('forks a Run without a bound unplaced queue input while retaining positionless legacy input', async () => {
    const context = preparePiBranch(sessionId, undefined, 'native-parent')
    const input = (text: string) =>
      agentSessionMessageService.saveMessage({
        sessionId,
        message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
      })
    const legacy = input('Legacy')
    const local = input('/compact')
    dbh.db
      .update(agentSessionMessageTable)
      .set({ inputContextId: context.id, data: { locallyHandled: true } })
      .where(eq(agentSessionMessageTable.id, local.id))
      .run()
    replaceAgentSessionMessagePartsTx(dbh.db, {
      sessionId,
      messageId: local.id,
      timestampMs: Date.now(),
      parts: [{ type: 'text', text: '/compact' }]
    })
    const b = input('B')
    const queued = input('Unplaced D')
    const rb = agentSessionMessageService.saveMessage({
      sessionId,
      runtimeResumeToken: 'native-parent',
      runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native-parent', leafId: 'B' } },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'B reply' }] } }
    })
    dbh.db
      .update(agentSessionMessageTable)
      .set({ pos: 2, replyId: rb.id })
      .where(eq(agentSessionMessageTable.id, b.id))
      .run()
    dbh.db
      .update(agentSessionMessageTable)
      .set({ inputContextId: context.id })
      .where(eq(agentSessionMessageTable.id, queued.id))
      .run()
    const child = await new AgentSessionForkOperations().fork(sessionId, rb.id)
    const texts = agentSessionMessageService
      .listSessionMessages(child)
      .items.flatMap((row) => row.data.parts?.filter((part) => part.type === 'text').map((part) => part.text) ?? [])
    expect(texts).toContain('Legacy')
    expect(texts).toContain('/compact')
    expect(texts).toContain('B reply')
    expect(texts).not.toContain('Unplaced D')
    expect(agentSessionMessageService.getSessionMessage(sessionId, legacy.id).pos).toBeNull()
  })

  it('publishes an independent child without app_state and keeps its files after source deletion', async () => {
    const createdAt = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(createdAt)
    beforeForkResult = async () => {
      now.mockReturnValue(createdAt + 1_000)
    }
    const notified: string[] = []
    vi.spyOn(agentSessionService, 'notifyReadModelChange').mockImplementation((ids) => {
      expect(dbh.sqlite.inTransaction).toBe(false)
      for (const id of ids) {
        expect(agentSessionService.getById(id).name).toBe('Source (1)')
        expect(agentSessionMessageService.getLastRuntimeResumeToken(id)).toBe('native-child')
        notified.push(id)
      }
    })
    const childId = await new AgentSessionForkOperations().fork(sessionId, messageId)
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, childId)).get()).toMatchObject({
      type: 'conversation',
      createdAt
    })
    expect(notified).toEqual([childId])
    expect(agentSessionMessageService.listSessionMessages(childId).items[0].data.parts).toEqual([
      { type: 'text', text: 'Preserved answer' },
      { type: 'data-agent-session-fork', data: { sourceSessionId: sessionId } }
    ])
    expect(agentSessionMessageService.listSessionMessages(sessionId).items[0].data.parts).toEqual([
      { type: 'text', text: 'Preserved answer' }
    ])
    expect(await readForkResources()).toEqual([
      expect.objectContaining({
        targetSessionId: childId,
        published: [expect.objectContaining({ target: publishedFile })]
      })
    ])
    expect(dbh.db.select().from(appStateTable).all()).toEqual([])
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).run()
    await new AgentSessionForkOperations().recover()
    expect(await readFile(publishedFile, 'utf8')).toBe('native child history')
    expect(agentSessionMessageService.getLastRuntimeResumeToken(childId)).toBe('native-child')
    expect(agentSessionMessageService.listSessionMessages(childId).items[0].data.parts?.at(-1)).toEqual({
      type: 'data-agent-session-fork',
      data: { sourceSessionId: sessionId }
    })
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, childId)).run()
    await new AgentSessionForkOperations().recover()
    expect(await readForkResources()).toEqual([])
    await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels a prepared native fork without publishing a child or retaining owned resources', async () => {
    const prepared = Promise.withResolvers<void>()
    beforeForkResult = async (input) => {
      prepared.resolve()
      await once(input.signal, 'abort')
      input.signal.throwIfAborted()
    }
    const operations = new AgentSessionForkOperations()
    const fork = operations.fork(sessionId, messageId)
    const rejected = expect(fork).rejects.toMatchObject({ reason: 'cancelled' })
    await prepared.promise
    await operations.cancel(sessionId)
    await rejected
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((row) => row.id)
    ).toEqual([sessionId])
    expect(await readForkResources()).toEqual([])
    await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('copies conversation content without inheriting approval authority or live task ownership', async () => {
    const source = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, messageId))
      .get()!
    const parts = [
      { type: 'text' as const, text: 'Preserved answer' },
      {
        type: 'dynamic-tool' as const,
        toolName: 'bash',
        toolCallId: 'live-approval',
        state: 'approval-requested' as const,
        input: { command: 'echo protected' },
        approval: { id: 'source-approval' }
      },
      {
        type: 'data-agent-task-event' as const,
        data: { event: 'started' as const, taskId: 'live-task', status: 'in_progress' as const }
      }
    ]
    replaceAgentSessionMessagePartsTx(dbh.db, { sessionId, messageId, parts, timestampMs: source.updatedAt })
    const childId = await new AgentSessionForkOperations().fork(sessionId, messageId)
    const child = agentSessionMessageService.listSessionMessages(childId).items[0]
    expect(child.data.parts).toEqual([
      parts[0],
      {
        type: 'dynamic-tool',
        toolName: 'bash',
        toolCallId: 'live-approval',
        input: { command: 'echo protected' },
        state: 'output-error',
        errorText: expect.any(String)
      },
      { type: 'data-agent-session-fork', data: { sourceSessionId: sessionId } }
    ])
    expect(agentSessionMessageService.getSessionMessage(sessionId, messageId).data.parts).toEqual(parts)
  })

  // Editing must never append the replacement to the old native prompt or partially delete a turn.
  it.each(['commit', 'after steer', 'first message', 'history changed', 'close failed', 'write failed'] as const)(
    'edits a native prefix: %s',
    async (outcome) => {
      if (outcome === 'first message') agentSessionMessageService.deleteSessionMessage(sessionId, messageId)
      const steer =
        outcome === 'after steer'
          ? agentSessionMessageService.saveMessage({
              sessionId,
              message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Steer' }] } }
            })
          : undefined
      if (steer) agentSessionMessageService.linkReply(sessionId, [steer.id], messageId)
      const tail = dbh.db.transaction((tx) =>
        agentSessionMessageService.saveMessagesTx(tx, {
          sessionId,
          messages: [
            { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Old question' }] } },
            { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Old answer' }] } },
            { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Later question' }] } },
            { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Later answer' }] } }
          ]
        })
      )
      const target = {
        messageId: tail[0].id,
        version: agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, tail[0].id).version
      }
      beforeForkResult = async (input) => {
        if (outcome === 'first message') throw new Error('Empty history must not fork the old native session')
        expect(input.targetCwd).toBe(directory)
        expect(input.checkpoint).toMatchObject({ leafId: 'leaf' })
        if (outcome === 'history changed')
          tail.push(
            ...dbh.db.transaction((tx) =>
              agentSessionMessageService.saveMessagesTx(tx, {
                sessionId,
                messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'New input' }] } }]
              })
            )
          )
      }
      const operation = new AgentSessionForkOperations().edit(
        sessionId,
        target,
        async () => {
          if (outcome === 'close failed') throw new Error('close failed')
        },
        (tx, nativeSessionId) => {
          const saved = agentSessionMessageService.saveMessagesTx(tx, {
            sessionId,
            messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'New question' }] } }]
          })
          reservePiBranchTx(tx, sessionId, saved[0].id, nativeSessionId)
          agentSessionMessageService.setEditRuntimeTx(tx, sessionId, saved[0].id, nativeSessionId)
          if (outcome === 'write failed') throw new Error('write failed')
          return saved[0].id
        }
      )
      if (outcome === 'commit' || outcome === 'after steer' || outcome === 'first message') {
        const newId = await operation
        const rows = agentSessionMessageService.listSessionMessages(sessionId).items.toReversed()
        expect(rows.map((row) => row.id)).toEqual(
          outcome === 'first message' ? [newId] : [messageId, ...(steer ? [steer.id] : []), newId]
        )
        expect(rows.at(-1)?.data).toEqual({ parts: [{ type: 'text', text: 'New question' }] })
        if (outcome === 'commit' || outcome === 'after steer') {
          expect(agentSessionMessageService.getNativeSessionId(sessionId)).toBe('native-child')
          expect(
            agentSessionMessageService
              .readEditSnapshotTx(dbh.db, sessionId, newId)
              .prefix.filter((row) => row.role === 'assistant')
              .map((row) => row.data)
          ).toEqual([
            expect.objectContaining({
              runtimeAnchor: { checkpoint: expect.objectContaining({ runtimeSessionId: 'native-child' }) }
            })
          ])
        } else expect(agentSessionMessageService.getNativeSessionId(sessionId)).toMatch(/^[\da-f-]{36}$/)
        expect(agentSessionMessageService.getNativeSessionId(sessionId)).not.toBe(sessionId)
        expect(agentSessionMessageService.getLastRuntimeResumeToken(sessionId)).toBe(
          outcome === 'commit' || outcome === 'after steer' ? 'native-child' : null
        )
        expect(agentSessionService.getById(sessionId).workspace.path).toBe(directory)
        await new AgentSessionForkOperations().recover()
        if (outcome === 'commit' || outcome === 'after steer') {
          expect(rows[0].data.parts).toEqual([{ type: 'text', text: 'Preserved answer' }])
          expect(await readFile(publishedFile, 'utf8')).toBe('native child history')
        } else {
          expect(await readForkResources()).toEqual([])
        }
        await expect(
          new AgentSessionForkOperations().edit(
            sessionId,
            target,
            async () => {},
            () => {}
          )
        ).rejects.toMatchObject({ reason: 'invalid_target' })
        for (const row of tail) expect(() => agentSessionMessageService.getSessionMessage(sessionId, row.id)).toThrow()
        expect(rows.at(-1)?.siblings).toEqual([newId])
        expect(agentSessionMessageService.getLastRuntimeResumeToken(sessionId)).toBe(
          outcome === 'commit' || outcome === 'after steer' ? 'native-child' : null
        )
      } else {
        await expect(operation).rejects.toThrow()
        expect(
          agentSessionMessageService
            .listSessionMessages(sessionId)
            .items.toReversed()
            .map((row) => row.id)
        ).toEqual([messageId, ...tail.map((row) => row.id)])
        expect(agentSessionMessageService.getLastRuntimeResumeToken(sessionId)).toBe('native-parent')
        expect(await readForkResources()).toEqual([])
      }
    }
  )

  it.each(['missing', 'assistant'] as const)('rejects an invalid edit target: %s', (target) => {
    expect(() =>
      agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, target === 'missing' ? randomUUID() : messageId)
    ).toThrow('invalid_target')
    expect(agentSessionMessageService.listSessionMessages(sessionId).items.map((row) => row.id)).toEqual([messageId])
  })

  it('keeps later turns when the boundary before an edited message has no checkpoint', async () => {
    dbh.db.update(agentSessionMessageTable).set({ data: {} }).where(eq(agentSessionMessageTable.id, messageId)).run()
    const tail = dbh.db.transaction((tx) =>
      agentSessionMessageService.saveMessagesTx(tx, {
        sessionId,
        messages: [
          { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Question A' }] } },
          { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Answer A' }] } },
          { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Question B' }] } }
        ]
      })
    )
    const target = {
      messageId: tail[0].id,
      version: agentSessionMessageService.readEditSnapshotTx(dbh.db, sessionId, tail[0].id).version
    }
    await expect(
      new AgentSessionForkOperations().edit(
        sessionId,
        target,
        async () => {},
        () => {}
      )
    ).rejects.toMatchObject({ reason: 'checkpoint_unsupported' })
    expect(
      agentSessionMessageService
        .listSessionMessages(sessionId)
        .items.toReversed()
        .map((row) => row.id)
    ).toEqual([messageId, ...tail.map((row) => row.id)])
  })

  it('replaces inherited links with the direct parent only at the new fork boundary', async () => {
    const childId = await new AgentSessionForkOperations().fork(sessionId, messageId)
    const nextMessageId = randomUUID()
    agentSessionMessageService.saveMessage({
      sessionId: childId,
      runtimeResumeToken: 'native-child',
      runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native-child', leafId: 'next' } },
      message: {
        id: nextMessageId,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Next answer' }] }
      }
    })
    publishedFile = path.join(directory, 'native', 'grandchild.jsonl')
    const grandchildId = await new AgentSessionForkOperations().fork(childId, nextMessageId)
    const messages = agentSessionMessageService.listSessionMessages(grandchildId).items
    expect(messages.toReversed().map((message) => message.data.parts)).toEqual([
      [{ type: 'text', text: 'Preserved answer' }],
      [
        { type: 'text', text: 'Next answer' },
        { type: 'data-agent-session-fork', data: { sourceSessionId: childId } }
      ]
    ])
  })

  it.each(['database-failure', 'invalid-checkpoint'] as const)(
    'rolls back unpublished child rows and files: %s',
    async (scenario) => {
      invalidCheckpoint = scenario === 'invalid-checkpoint'
      if (scenario === 'database-failure') {
        dbh.sqlite.exec(`CREATE TRIGGER reject_fork_messages BEFORE INSERT ON agent_session_message
        BEGIN SELECT RAISE(ABORT, 'message commit failed'); END`)
      }
      const notifications: string[] = []
      vi.spyOn(agentSessionService, 'notifyReadModelChange').mockImplementation((ids) => notifications.push(...ids))
      await expect(new AgentSessionForkOperations().fork(sessionId, messageId)).rejects.toThrow()
      expect(dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable).all()).toEqual([{ id: sessionId }])
      expect(
        dbh.db
          .select({ id: agentSessionMessageTable.id })
          .from(agentSessionMessageTable)
          .where(ne(agentSessionMessageTable.role, 'root'))
          .all()
      ).toEqual([{ id: messageId }])
      expect(notifications).toEqual([])
      expect(await readForkResources()).toEqual([])
      expect(await readdir(forkRoot)).toEqual([])
      await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it.each(['before-fork', 'before-publication'])('rejects an archived source: %s', async (stage) => {
    const archive = () => {
      dbh.db.update(agentSessionTable).set({ deletedAt: Date.now() }).where(eq(agentSessionTable.id, sessionId)).run()
    }
    if (stage === 'before-fork') archive()
    else beforeForkResult = async () => archive()

    await expect(new AgentSessionForkOperations().fork(sessionId, messageId)).rejects.toMatchObject({
      reason: 'source_missing'
    })
    expect(dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable).all()).toEqual([{ id: sessionId }])
    expect(await readForkResources()).toEqual([])
    await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not clean an in-flight operation while recovering deleted sessions', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    beforeForkResult = async () => {
      entered.resolve()
      await release.promise
    }
    const owner = new AgentSessionForkOperations()
    const pending = owner.fork(sessionId, messageId)
    try {
      await entered.promise
      await owner.recover()
      const resources = (await readForkResources())[0]
      expect(
        await readFile(
          path.join(resources.artifactDirectory, (await readdir(resources.artifactDirectory))[0], 'native.jsonl'),
          'utf8'
        )
      ).toBe('native child history')
    } finally {
      release.resolve()
    }
    const childId = await pending
    expect(agentSessionMessageService.getLastRuntimeResumeToken(childId)).toBe('native-child')
  })

  it('refuses to publish a runtime artifact from outside the fork artifact directory', async () => {
    artifactSourceFor = (artifactDirectory) => path.join(`${artifactDirectory}-sibling`, 'native.jsonl')
    await expect(new AgentSessionForkOperations().fork(sessionId, messageId)).rejects.toThrow(
      'Unowned SDK fork artifact'
    )
    expect(dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable).all()).toEqual([{ id: sessionId }])
    await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back published files if persisting their ownership fails, then allows retry', async () => {
    const write = fileUtils.atomicWriteFile
    const injected = vi.spyOn(fileUtils, 'atomicWriteFile').mockImplementation(async (file, data, options) => {
      if (JSON.parse(String(data)).published[0]?.identity) throw new Error('resource write failed')
      await write(file, data, options)
    })
    await expect(new AgentSessionForkOperations().fork(sessionId, messageId)).rejects.toThrow('resource write failed')
    expect(dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable).all()).toEqual([{ id: sessionId }])
    expect(await readForkResources()).toEqual([])
    await expect(readFile(publishedFile)).rejects.toMatchObject({ code: 'ENOENT' })
    injected.mockRestore()
    const childId = await new AgentSessionForkOperations().fork(sessionId, messageId)
    expect(agentSessionMessageService.getLastRuntimeResumeToken(childId)).toBe('native-child')
    expect(await readFile(publishedFile, 'utf8')).toBe('native child history')
  })

  it('recovers staged resources after restart without a database operation record', async () => {
    const operationId = randomUUID()
    const artifactDirectory = path.join(forkRoot, operationId)
    await mkdir(artifactDirectory, { recursive: true })
    const { forkFileIdentity } = await import('../files')
    const resources = {
      version: 1 as const,
      operationId,
      targetSessionId: randomUUID(),
      createdAt: Date.now(),
      artifactDirectory,
      artifactIdentity: await forkFileIdentity(artifactDirectory),
      published: []
    }
    await writeFile(path.join(artifactDirectory, 'partial.jsonl'), 'unfinished native fork')
    await writeForkResources(resources)
    await new AgentSessionForkOperations().recover()
    expect(await readdir(forkRoot)).toEqual([])
    expect(dbh.db.select().from(appStateTable).all()).toEqual([])
  })
})
