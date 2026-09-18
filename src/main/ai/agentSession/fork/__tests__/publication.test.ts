import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { RuntimeForkInput, RuntimeForkResult } from '@main/ai/runtime/fork'
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
  let previous: ReturnType<typeof runtimeDriverRegistry.getAgentSessionDriver>

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'fork-publication-'))
    forkRoot = path.join(directory, 'forks')
    publishedFile = path.join(directory, 'native', 'child.jsonl')
    beforeForkResult = async () => {}
    invalidCheckpoint = false
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
      capabilities: ['agent-session'],
      validateSession() {},
      async listAvailableTools() {
        return []
      },
      async connect() {
        throw new Error('Fork must not start a conversation')
      },
      async fork(input): Promise<RuntimeForkResult> {
        const source = path.join(input.artifactDirectory, 'native.jsonl')
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
      expect(dbh.db.select({ id: agentSessionMessageTable.id }).from(agentSessionMessageTable).all()).toEqual([
        { id: messageId }
      ])
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
      expect(await readFile(path.join(resources.artifactDirectory, 'native.jsonl'), 'utf8')).toBe(
        'native child history'
      )
    } finally {
      release.resolve()
    }
    const childId = await pending
    expect(agentSessionMessageService.getLastRuntimeResumeToken(childId)).toBe('native-child')
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
