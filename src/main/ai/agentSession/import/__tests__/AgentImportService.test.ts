import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentImportService } from '../AgentImportService'
import * as importers from '../importers'
import type { ConversationImporter, ImportConversation } from '../types'
import { archiveFixture, conversation, message } from './fixtures'

describe('Agent import publication', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let agentId: string
  beforeEach(async () => {
    BaseService.resetInstances()
    directory = await mkdtemp(join(tmpdir(), 'deepseek-publication-'))
    vi.mocked(application.getPath).mockImplementation((key, file) =>
      file ? join(directory, key, file) : join(directory, key)
    )
    agentId = randomUUID()
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, type: 'pi-durable', name: 'Import target', instructions: '', orderKey: 'a0' })
      .run()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })
  async function settle(service: AgentImportService) {
    await vi.waitFor(() => expect(service.status(agentId)?.status).not.toBe('running'), { timeout: 10_000 })
    return service.status(agentId)!
  }
  it('publishes and resumes another importer using normalized history without DeepSeek metadata', async () => {
    const source: ImportConversation = {
      name: 'Another application',
      createdAt: 1000,
      updatedAt: 3000,
      activeSourceId: 'answer',
      messages: [
        {
          sourceId: 'question',
          parentSourceId: null,
          role: 'user',
          status: 'success',
          createdAt: 2000,
          data: { parts: [{ type: 'text', text: 'Question from another application' }] }
        },
        {
          sourceId: 'answer',
          parentSourceId: 'question',
          role: 'assistant',
          status: 'success',
          createdAt: 1000,
          model: { id: 'source-model', name: 'Source model', provider: 'source-provider' },
          data: { parts: [{ type: 'text', text: 'Selected answer' }] }
        },
        {
          sourceId: 'sibling',
          parentSourceId: 'question',
          role: 'assistant',
          status: 'error',
          createdAt: 2000,
          data: { parts: [{ type: 'text', text: 'Incomplete sibling' }] }
        }
      ]
    }
    const importer: ConversationImporter = {
      id: 'fixture',
      name: 'Another source',
      emoji: '📚',
      digest: async (file) =>
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      open: async () => ({
        sourceIds: ['conversation-with-string-id'],
        preview: async () => ({ messages: 3, missingFiles: [] }),
        load: async () => source,
        close: async () => {}
      })
    }
    const resolve = importers.getConversationImporter
    vi.spyOn(importers, 'getConversationImporter').mockImplementation((id) =>
      id === importer.id ? importer : resolve(id)
    )
    const file = join(directory, 'history.json')
    await writeFile(file, JSON.stringify(source))
    const service = new AgentImportService()
    const preview = await service.prepare(agentId, file, importer.id)
    expect(preview).toMatchObject({ conversations: 1, messages: 3, status: 'ready' })
    service.start(preview.id)
    const result = await settle(service)
    expect(result).toMatchObject({ status: 'completed', imported: 1 })
    const session = dbh.db.select().from(agentSessionTable).get()!
    const rows = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .filter((row) => row.role !== 'root')
    const selected = rows.find((row) => row.id === session.activeNodeId)!
    const question = rows.find((row) => row.role === 'user')!
    expect(session.name).toBe('Another application')
    expect(selected).toMatchObject({
      parentId: question.id,
      role: 'assistant',
      status: 'success',
      createdAt: 2001,
      data: { parts: [{ type: 'text', text: 'Selected answer' }] },
      messageSnapshot: {
        name: 'Another source',
        emoji: '📚',
        model: { id: 'source-model', name: 'Source model', provider: 'source-provider' }
      }
    })
    expect(rows.find((row) => row.status === 'error')).toMatchObject({ parentId: question.id, messageSnapshot: null })
    expect(rows.every((row) => row.data.importedHistory === undefined)).toBe(true)
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
    BaseService.resetInstances()
    const reopened = new AgentImportService()
    reopened.start(preview.id)
    expect(await settle(reopened)).toMatchObject({ status: 'completed', skipped: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toHaveLength(4)
  })
  it('rejects conflicting attachment IDs before publishing any session', async () => {
    const source = conversation()
    const attachment = {
      id: 'shared',
      file_name: 'image.png',
      file_size: 1,
      export_path: 'files/one.png',
      is_image: true
    }
    source.messages[0].fragments.push({ type: 'FILE', files: [attachment] })
    source.messages[1].fragments.push({ type: 'FILE', files: [{ ...attachment, export_path: 'files/two.png' }] })
    const service = new AgentImportService()
    const file = await archiveFixture(
      [
        ['files/one.png', 'a'],
        ['files/two.png', 'b']
      ],
      3,
      source
    )
    await expect(service.prepare(agentId, file)).rejects.toThrow('Conflicting DeepSeek attachment ID')
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
  })
  it.each(['2026-01-01T00:00:00Z', '2025-12-31T23:59:59Z'])(
    'keeps consecutive users before the answer across pages when its timestamp is %s',
    async (answerTime) => {
      const source = conversation()
      source.current_message_id = 3
      source.messages = [message(1, null, 'USER', 'u1'), message(2, 1, 'USER', 'u2'), message(3, 2, 'ASSISTANT', 'a1')]
      source.messages[2].inserted_at = answerTime
      const service = new AgentImportService()
      const preview = await service.prepare(agentId, await archiveFixture([], 3, source))
      service.start(preview.id)
      const result = await settle(service)
      expect(result.status).toBe('completed')
      const newest = agentSessionMessageService.listSessionMessages(result.sessionIds[0], { limit: 2 })
      const older = agentSessionMessageService.listSessionMessages(result.sessionIds[0], {
        limit: 2,
        cursor: newest.nextCursor
      })
      const chronological = [...newest.items, ...older.items].reverse()
      expect(chronological.map((row) => row.data.parts)).toEqual([
        [{ type: 'text', text: 'u1' }],
        [{ type: 'text', text: 'u2' }],
        [{ type: 'text', text: 'a1' }]
      ])
      expect(chronological.map((row) => row.data.importedHistory?.insertedAt)).toEqual(
        source.messages.map((item) => item.inserted_at)
      )
      expect(older.nextCursor).toBeUndefined()
    }
  )
  it('publishes all branches, selects the source head, and deduplicates a retry after service replacement', async () => {
    const service = new AgentImportService()
    const file = await archiveFixture()
    const original = await readFile(file)
    const preview = await service.prepare(agentId, file)
    expect(preview).toMatchObject({ conversations: 1, messages: 3, status: 'ready' })
    expect(await readdir(directory)).toEqual([])
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    service.start(preview.id)
    const result = await settle(service)
    expect(result).toMatchObject({ status: 'completed', imported: 1, failed: 0, remaining: 0 })
    const session = dbh.db.select().from(agentSessionTable).get()!
    const rows = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .filter((row) => row.role !== 'root')
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.id === session.activeNodeId)?.data.parts).toEqual([
      { type: 'text', text: 'Mango recorded' }
    ])
    expect(rows.filter((row) => row.role === 'assistant').map((row) => row.parentId)).toEqual([
      rows.find((row) => row.role === 'user')!.id,
      rows.find((row) => row.role === 'user')!.id
    ])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toHaveLength(0)
    const sibling = rows.find((row) =>
      row.data.parts?.some((part) => part.type === 'text' && part.text.includes('banana'))
    )!
    agentSessionMessageService.selectBranch(session.id, sibling.id)
    expect(sibling.runtimeResumeToken).toBeNull()
    expect(rows.every((row) => !row.data.runtimeAnchor)).toBe(true)
    BaseService.resetInstances()
    const reopened = new AgentImportService()
    reopened.start(preview.id)
    expect(await settle(reopened)).toMatchObject({ status: 'completed', imported: 0, skipped: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toHaveLength(4)
    expect(await readFile(file)).toEqual(original)
    expect(await readdir(directory)).toEqual([])
  })
  it('rejects a source ZIP changed after preview before publishing a session', async () => {
    const service = new AgentImportService()
    const file = await archiveFixture()
    const preview = await service.prepare(agentId, file)
    await writeFile(file, 'changed archive')
    service.start(preview.id)
    expect(await settle(service)).toMatchObject({
      status: 'failed',
      imported: 0,
      error: 'Import file changed'
    })
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
  })
  it('requires the source ZIP and accepts its new location when reselected', async () => {
    const service = new AgentImportService()
    const file = await archiveFixture()
    const preview = await service.prepare(agentId, file)
    const moved = join(directory, 'moved.zip')
    await rename(file, moved)
    service.start(preview.id)
    expect(await settle(service)).toMatchObject({ status: 'failed', imported: 0 })
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    const retry = await service.prepare(agentId, moved)
    expect(retry.id).toBe(preview.id)
    service.start(retry.id)
    expect(await settle(service)).toMatchObject({ status: 'completed', imported: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })
  it('rolls back product publication and retries without preparing native history', async () => {
    const service = new AgentImportService()
    const preview = await service.prepare(agentId, await archiveFixture())
    const insert = vi.spyOn(agentSessionMessageService, 'insertImportedMessagesTx').mockImplementationOnce(() => {
      throw new Error('Injected publication failure')
    })
    service.start(preview.id)
    expect(await settle(service)).toMatchObject({ status: 'failed', imported: 0, failed: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
    insert.mockRestore()
    BaseService.resetInstances()
    const recovered = new AgentImportService()
    recovered.start(preview.id)
    expect(await settle(recovered)).toMatchObject({ status: 'completed', imported: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })
  it.each(['pi', 'claude-code', 'pi-durable'] as const)(
    'imports into %s without native storage and cancels before publication',
    async (type) => {
      const service = new AgentImportService()
      dbh.db.update(agentTable).set({ type }).where(eq(agentTable.id, agentId)).run()
      const file = await archiveFixture()
      const preview = await service.prepare(agentId, file)
      service.start(preview.id)
      service.cancel(preview.id)
      expect(await settle(service)).toMatchObject({ status: 'cancelled', imported: 0, remaining: 1 })
      expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    }
  )
  it('blocks new work while paused and drains already admitted preparation', async () => {
    const service = new AgentImportService()
    const file = await archiveFixture()
    const preparing = service.prepare(agentId, file)
    const hold = service.pause('backup')
    await expect(service.prepare(agentId, file)).rejects.toThrow('paused')
    const preview = await preparing
    expect(() => service.start(preview.id)).toThrow('paused')
    expect(await service.drainInFlight({ timeoutMs: 1000 })).toEqual({ stragglerIds: [] })
    hold.dispose()
    service.start(preview.id)
    expect(await settle(service)).toMatchObject({ status: 'completed', imported: 1 })
  })
  it('reports committed sessions even when post-commit notifications fail', async () => {
    const service = new AgentImportService()
    const preview = await service.prepare(agentId, await archiveFixture())
    vi.spyOn(agentSessionService, 'notifyReadModelChange').mockImplementationOnce(() => {
      throw new Error('Window closed')
    })
    service.start(preview.id)
    expect(await settle(service)).toMatchObject({ status: 'completed', imported: 1, failed: 0 })
    BaseService.resetInstances()
    const reopened = new AgentImportService()
    reopened.start(preview.id)
    expect(await settle(reopened)).toMatchObject({ status: 'completed', skipped: 1 })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })
})
