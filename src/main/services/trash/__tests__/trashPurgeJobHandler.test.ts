// Registers MessageService in the data-service registry (topic purge resolves it).
import '@data/services/MessageService'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import type { JobContext } from '@main/core/job/types'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { rootRow, setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { agentJobsServiceMock, fileManagerMock, notifyDataApiDataChangeMock, sweepAgentOrphansMock } = vi.hoisted(
  () => ({
    agentJobsServiceMock: { deleteOrphanedSchedules: vi.fn(async () => 0) },
    fileManagerMock: { runSweep: vi.fn(async () => ({ outcome: 'completed' })) },
    notifyDataApiDataChangeMock: vi.fn(),
    sweepAgentOrphansMock: vi.fn(async () => ({ removed: [], failedDrivers: [] }))
  })
)

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

// Mock the agent-dir sweep so its post-commit failure path can be exercised
// without touching the real filesystem; the default resolves (clean run) so
// existing tests behave identically.
vi.mock('../agentOrphanSweep', () => ({ sweepAgentOrphans: sweepAgentOrphansMock }))

// The unified application mock does not carry feature services (FileManager is
// not in defaultServiceInstances) — route it locally, everything else falls
// through to the standard infrastructure mocks.
vi.mock('@application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  const application = createMockApplication()
  const container = application.getContainer()
  application.get.mockImplementation((name: string) => {
    if (name === 'AgentJobsService') return agentJobsServiceMock
    if (name === 'FileManager') return fileManagerMock
    return container.get(name)
  })
  return { application, serviceList: [] }
})

const { trashPurgeJobHandler } = await import('../trashPurgeJobHandler')

const DAY = 86_400_000
/** Older than the default 30-day retention. */
const OLD = Date.now() - 40 * DAY
/** Trashed, but still inside the retention window. */
const RECENT = Date.now() - 1 * DAY

function makeCtx(input: { emptyAll?: boolean } = {}): JobContext<{ emptyAll?: boolean }> {
  return {
    jobId: 'job-trash-test',
    input,
    attempt: 1,
    parentId: null,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn(async () => undefined),
    reportProgress: vi.fn(),
    logger: mockMainLoggerService as never
  }
}

describe('trashPurgeJobHandler', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    agentJobsServiceMock.deleteOrphanedSchedules.mockClear()
    agentJobsServiceMock.deleteOrphanedSchedules.mockImplementation(async () => 0)
    fileManagerMock.runSweep.mockClear()
    fileManagerMock.runSweep.mockImplementation(async () => ({ outcome: 'completed' }))
    sweepAgentOrphansMock.mockClear()
    sweepAgentOrphansMock.mockImplementation(async () => ({ removed: [], failedDrivers: [] }))
    notifyDataApiDataChangeMock.mockClear()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  async function seedFileEntry(id: string, deletedAt: number | null, origin: 'internal' | 'external' = 'internal') {
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin,
      name: id,
      ext: 'txt',
      size: origin === 'internal' ? 1 : null,
      externalPath: origin === 'external' ? `/Users/me/${id}.txt` : null,
      deletedAt,
      createdAt: 1,
      updatedAt: 1
    })
  }

  /** Seeds one expired + one recently-trashed + one active row per domain. */
  async function seedWorld() {
    // --- topics + their messages ---
    await dbh.db.insert(topicTable).values([
      { id: 'topic-expired', name: 'expired', orderKey: 'a0', deletedAt: OLD },
      { id: 'topic-recent', name: 'recent', orderKey: 'a1', deletedAt: RECENT },
      { id: 'topic-active', name: 'active', orderKey: 'a2' }
    ])
    await dbh.db.insert(messageTable).values([
      rootRow('topic-expired'),
      {
        id: 'msg-of-expired-topic',
        parentId: 'vroot-topic-expired',
        topicId: 'topic-expired',
        role: 'user',
        data: { parts: [] },
        status: 'success'
      },
      rootRow('topic-active'),
      // Messages are never moved to the Recycle Bin on their own — a live topic's messages must
      // survive the purge untouched.
      {
        id: 'msg-of-active-topic',
        parentId: 'vroot-topic-active',
        topicId: 'topic-active',
        role: 'user',
        data: { parts: [] },
        status: 'success'
      }
    ])
    // Attachment refs cascade with their message rows.
    await seedFileEntry('019606a0-0000-7000-8000-00000000aa01', null)
    await seedFileEntry('019606a0-0000-7000-8000-00000000aa02', null)
    await dbh.db.insert(chatMessageFileRefTable).values([
      {
        id: 'cmfr-expired-topic',
        fileEntryId: '019606a0-0000-7000-8000-00000000aa01',
        sourceId: 'msg-of-expired-topic',
        role: 'attachment'
      },
      {
        id: 'cmfr-active-msg',
        fileEntryId: '019606a0-0000-7000-8000-00000000aa02',
        sourceId: 'msg-of-active-topic',
        role: 'attachment'
      }
    ])

    // --- agents + sessions + session messages ---
    await dbh.db.insert(agentTable).values([
      { id: 'agent-live', type: 'claude-code', name: 'live', instructions: 'i', orderKey: 'a0' },
      { id: 'agent-expired', type: 'claude-code', name: 'expired', instructions: 'i', orderKey: 'a1', deletedAt: OLD }
    ])
    await dbh.db.insert(agentWorkspaceTable).values([
      { id: 'ws-expired', name: 'ws-expired', path: '/tmp/trash-purge-test/ws-expired', orderKey: 'a0' },
      { id: 'ws-recent', name: 'ws-recent', path: '/tmp/trash-purge-test/ws-recent', orderKey: 'a1' }
    ])
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-expired',
        agentId: 'agent-live',
        name: 'expired',
        workspaceId: 'ws-expired',
        orderKey: 'a0',
        deletedAt: OLD
      },
      {
        id: 'session-recent',
        agentId: 'agent-live',
        name: 'recent',
        workspaceId: 'ws-recent',
        orderKey: 'a1',
        deletedAt: RECENT
      }
    ])
    await dbh.db.insert(agentSessionMessageTable).values({
      id: 'asm-expired',
      sessionId: 'session-expired',
      role: 'user',
      data: { parts: [] },
      status: 'success'
    })

    // --- assistants ---
    await dbh.db.insert(assistantTable).values([
      {
        id: 'assistant-expired',
        name: 'expired',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0',
        deletedAt: OLD
      },
      {
        id: 'assistant-recent',
        name: 'recent',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a1',
        deletedAt: RECENT
      }
    ])

    // --- paintings + output refs ---
    await dbh.db.insert(paintingTable).values([
      { id: 'painting-expired', providerId: 'p', prompt: 'x', orderKey: 'a0', deletedAt: OLD },
      { id: 'painting-recent', providerId: 'p', prompt: 'y', orderKey: 'a1', deletedAt: RECENT }
    ])
    await seedFileEntry('019606a0-0000-7000-8000-00000000bb01', null)
    await seedFileEntry('019606a0-0000-7000-8000-00000000bb02', null)
    await dbh.db.insert(paintingFileRefTable).values([
      {
        id: 'pfr-expired',
        fileEntryId: '019606a0-0000-7000-8000-00000000bb01',
        sourceId: 'painting-expired',
        role: 'output'
      },
      {
        id: 'pfr-recent',
        fileEntryId: '019606a0-0000-7000-8000-00000000bb02',
        sourceId: 'painting-recent',
        role: 'output'
      }
    ])

    // --- file entries ---
    await seedFileEntry('019606a0-0000-7000-8000-00000000cc01', OLD)
    await seedFileEntry('019606a0-0000-7000-8000-00000000cc02', RECENT)
    await seedFileEntry('019606a0-0000-7000-8000-00000000cc03', null, 'external')
  }

  const allIds = (rows: Array<{ id: string }>) => rows.map((row) => row.id)

  it('purges expired rows across all domains, keeps unexpired ones, and fires FK cascades', async () => {
    await seedWorld()

    let expiredTopicRowsAtSweepTime = -1
    let expiredAgentRowsAtScheduleSweepTime = -1
    agentJobsServiceMock.deleteOrphanedSchedules.mockImplementation(async () => {
      expiredAgentRowsAtScheduleSweepTime = dbh.db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(eq(agentTable.id, 'agent-expired'))
        .all().length
      return 0
    })
    fileManagerMock.runSweep.mockImplementation(async () => {
      // Captures ordering: by the time the file sweep runs, the DB purge of
      // every domain must already be committed.
      expiredTopicRowsAtSweepTime = dbh.db
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(eq(topicTable.id, 'topic-expired'))
        .all().length
      return { outcome: 'completed' }
    })

    const ctx = makeCtx({})
    const result = await trashPurgeJobHandler.execute(ctx)

    expect(result).toEqual({
      skipped: false,
      reclaimed: true,
      purged: {
        topic: 1,
        session: 1,
        agent: 1,
        assistant: 1,
        painting: 1,
        fileEntry: 1
      }
    })

    // topics: expired gone (with all its messages), recent + active retained
    expect(allIds(dbh.db.select({ id: topicTable.id }).from(topicTable).all()).sort()).toEqual([
      'topic-active',
      'topic-recent'
    ])
    const messageIds = allIds(dbh.db.select({ id: messageTable.id }).from(messageTable).all())
    expect(messageIds).not.toContain('vroot-topic-expired')
    expect(messageIds).not.toContain('msg-of-expired-topic')
    // a live topic's messages are never touched by the purge
    expect(messageIds).toContain('msg-of-active-topic')
    // chat_message_file_ref rows cascade with their messages, and only those
    expect(allIds(dbh.db.select({ id: chatMessageFileRefTable.id }).from(chatMessageFileRefTable).all())).toEqual([
      'cmfr-active-msg'
    ])

    // sessions: expired gone with its messages cascaded, recent retained
    expect(allIds(dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable).all())).toEqual([
      'session-recent'
    ])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])

    // agents / assistants
    expect(allIds(dbh.db.select({ id: agentTable.id }).from(agentTable).all())).toEqual(['agent-live'])
    expect(allIds(dbh.db.select({ id: assistantTable.id }).from(assistantTable).all())).toEqual(['assistant-recent'])

    // paintings: expired gone with its ref cascaded, recent keeps its ref
    expect(allIds(dbh.db.select({ id: paintingTable.id }).from(paintingTable).all())).toEqual(['painting-recent'])
    expect(allIds(dbh.db.select({ id: paintingFileRefTable.id }).from(paintingFileRefTable).all())).toEqual([
      'pfr-recent'
    ])

    // file entries: expired internal gone; recent internal + external retained
    const fileIds = allIds(dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable).all())
    expect(fileIds).not.toContain('019606a0-0000-7000-8000-00000000cc01')
    expect(fileIds).toContain('019606a0-0000-7000-8000-00000000cc02')
    expect(fileIds).toContain('019606a0-0000-7000-8000-00000000cc03')

    // disk sweep ran after all DB purge transactions committed
    expect(agentJobsServiceMock.deleteOrphanedSchedules).toHaveBeenCalledTimes(1)
    expect(expiredAgentRowsAtScheduleSweepTime).toBe(0)
    expect(fileManagerMock.runSweep).toHaveBeenCalledTimes(1)
    expect(expiredTopicRowsAtSweepTime).toBe(0)
    expect(ctx.reportProgress).toHaveBeenLastCalledWith(100)
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      { endpoint: '/topics/:topicId/messages', kind: 'membership' },
      { endpoint: '/topics/:topicId/tree' },
      { endpoint: '/messages/:id' }
    ])
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership' },
      { endpoint: '/agent-sessions/:sessionId/messages/:messageId' }
    ])
  })

  it('purges domains in RFC §6 order: topic → session → agent → assistant → painting → file entry', async () => {
    const { topicService } = await import('@data/services/TopicService')
    const { agentSessionService } = await import('@data/services/AgentSessionService')
    const { agentService } = await import('@data/services/AgentService')
    const { assistantDataService } = await import('@data/services/AssistantService')
    const { paintingService } = await import('@data/services/PaintingService')
    const { fileEntryService } = await import('@data/services/FileEntryService')

    const spies = [
      vi.spyOn(topicService, 'purgeExpiredTx'),
      vi.spyOn(agentSessionService, 'purgeExpiredTx'),
      vi.spyOn(agentService, 'purgeExpiredTx'),
      vi.spyOn(assistantDataService, 'purgeExpiredTx'),
      vi.spyOn(paintingService, 'purgeExpiredTx'),
      vi.spyOn(fileEntryService, 'purgeExpiredTx')
    ]
    try {
      await trashPurgeJobHandler.execute(makeCtx({}))

      const firstCallOrder = spies.map((spy) => spy.mock.invocationCallOrder[0])
      expect(firstCallOrder.every((order) => order !== undefined)).toBe(true)
      expect(firstCallOrder).toEqual([...firstCallOrder].sort((a, b) => a - b))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('keeps draining a domain in batches until a batch comes back short', async () => {
    const { topicService } = await import('@data/services/TopicService')

    const rows = Array.from({ length: 501 }, (_, i) => ({
      id: `topic-bulk-${String(i).padStart(4, '0')}`,
      name: 'bulk',
      orderKey: `a${i}`,
      deletedAt: OLD
    }))
    for (let i = 0; i < rows.length; i += 100) {
      await dbh.db.insert(topicTable).values(rows.slice(i, i + 100))
    }

    const spy = vi.spyOn(topicService, 'purgeExpiredTx')
    try {
      const result = await trashPurgeJobHandler.execute(makeCtx({}))

      // 501 expired rows with batch size 500 → one full batch + one short batch.
      expect(spy).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ skipped: false, purged: expect.objectContaining({ topic: 501 }) })
      expect(dbh.db.select({ id: topicTable.id }).from(topicTable).all()).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('swallows post-commit disk-sweep failures (RFC §6: logged, never thrown)', async () => {
    await seedWorld()
    // Both post-commit reclamation sweeps blow up; the handler must still
    // resolve with the committed purge counts rather than reject.
    fileManagerMock.runSweep.mockRejectedValueOnce(new Error('disk unlink failed'))
    sweepAgentOrphansMock.mockRejectedValueOnce(new Error('rmdir failed'))

    const ctx = makeCtx({})
    const result = await trashPurgeJobHandler.execute(ctx)

    // DB purge stays committed even though disk reclamation errored.
    expect(result).toMatchObject({ skipped: false, purged: expect.objectContaining({ topic: 1 }) })
    expect(allIds(dbh.db.select({ id: topicTable.id }).from(topicTable).all())).not.toContain('topic-expired')
    // Both sweeps were attempted, and progress still reached 100%.
    expect(fileManagerMock.runSweep).toHaveBeenCalledTimes(1)
    expect(sweepAgentOrphansMock).toHaveBeenCalledTimes(1)
    expect(ctx.reportProgress).toHaveBeenLastCalledWith(100)
  })

  it('keeps every row when retention is 0, but still reclaims disk residue', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('data.trash.retention_days', 0)
    await dbh.db.insert(topicTable).values({ id: 'topic-expired', name: 'expired', orderKey: 'a0', deletedAt: OLD })

    const result = await trashPurgeJobHandler.execute(makeCtx({}))

    expect(result).toMatchObject({ skipped: true, purged: {} })
    expect(allIds(dbh.db.select({ id: topicTable.id }).from(topicTable).all())).toEqual(['topic-expired'])
    // Retention 0 disables the row purge only — permanent deletes still strand runtime
    // state, and it would otherwise never be reclaimed.
    expect(fileManagerMock.runSweep).toHaveBeenCalledTimes(1)
    expect(sweepAgentOrphansMock).toHaveBeenCalledTimes(1)
    expect(agentJobsServiceMock.deleteOrphanedSchedules).toHaveBeenCalledTimes(1)
  })

  it('emptyAll purges every trashed row regardless of retention, sparing active rows', async () => {
    // retention 0 would normally disable the purge — emptyAll must override it.
    MockMainPreferenceServiceUtils.setPreferenceValue('data.trash.retention_days', 0)
    await dbh.db.insert(topicTable).values([
      { id: 'topic-just-trashed', name: 'fresh trash', orderKey: 'a0', deletedAt: Date.now() - 1000 },
      { id: 'topic-active', name: 'active', orderKey: 'a1' }
    ])

    const result = await trashPurgeJobHandler.execute(makeCtx({ emptyAll: true }))

    expect(result).toMatchObject({ skipped: false, purged: expect.objectContaining({ topic: 1 }) })
    expect(allIds(dbh.db.select({ id: topicTable.id }).from(topicTable).all())).toEqual(['topic-active'])
    expect(fileManagerMock.runSweep).toHaveBeenCalledTimes(1)
  })
})
