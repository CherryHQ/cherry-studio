import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runPostPromotionWork } from '../postPromotion'

/**
 * The post-promotion rebuild (§6.7).
 *
 * A restored Knowledge base arrives without its vector index — export excludes
 * it as derived state — and an empty index never rebuilds itself, so without
 * this the base would search empty forever. The interesting cases are all about
 * what must NOT be enqueued: bases this device has no directory for, bases whose
 * index already exists, and anything at all when the last restore did not
 * actually complete.
 */

const BASE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
// Items are UUIDv7 (`uuidPrimaryKeyOrdered`); bases are UUIDv4.
const ITEM_ID = 'aaaaaaaa-bbbb-7ccc-8ddd-ffffffffffff'

describe('post-promotion work', () => {
  const dbh = setupTestDatabase()
  let userData = ''
  const reindexItems = vi.fn(async () => {})
  // Stands in for the real service, reading the same layout the test writes.
  const hasIndexStore = vi.fn(async (baseId: string) =>
    existsSync(join(userData, 'Data', 'KnowledgeBase', baseId, '.cherry', 'index.sqlite'))
  )

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-postpromote-'))
    reindexItems.mockClear()

    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const base = pathFor(key)
      return filename ? join(base, filename) : base
    })
    const realGet = application.get.bind(application) as (name: string) => unknown
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'KnowledgeService') return { reindexItems }
      if (name === 'KnowledgeVectorStoreService') return { hasIndexStore }
      return realGet(name)
    }) as unknown as typeof application.get)

    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: BASE_ID, name: 'restored', status: 'completed', chunkSize: 512, chunkOverlap: 32 })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: ITEM_ID,
        baseId: BASE_ID,
        type: 'file',
        status: 'completed',
        data: { source: 'doc.pdf', relativePath: 'raw/doc.pdf' }
      })
      .run()
    writeRestoreJournalV2(journal('completed'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function pathFor(key: string): string {
    switch (key) {
      case 'app.userdata':
        return userData
      case 'feature.backup.restore.file':
        return join(userData, 'restore-journal.json')
      case 'feature.files.data':
        return join(userData, 'Data', 'Files')
      case 'feature.knowledgebase.data':
        return join(userData, 'Data', 'KnowledgeBase')
      case 'feature.notes.data':
        return join(userData, 'Data', 'Notes')
      case 'feature.agents.data':
        return join(userData, 'Data', 'Agents')
      case 'feature.agents.system_workspaces':
        return join(userData, 'Data', 'Agents', 'system')
      case 'feature.agents.skills':
        return join(userData, 'Data', 'Skills')
      default:
        throw new Error(`Unexpected path key in postPromotion test: ${key}`)
    }
  }

  function journal(state: 'completed' | 'failed' | 'prepared') {
    const base = {
      version: 2 as const,
      restoreId: '11111111-2222-4333-8444-555555555555',
      preset: 'lite' as const,
      createdAt: '2026-07-27T00:00:00.000Z',
      db: {
        promote: 'restore-staging/x/backup.sqlite',
        aside: 'cherrystudio.sqlite.pre-restore-x',
        chain: [{ folderMillis: 1_730_000_000_000, hash: 'h' }]
      },
      resourceInstalls: []
    }
    if (state === 'completed') {
      return { ...base, state, step: 'integrity-ok' as const, summary: { knowledgeBaseIds: [] } }
    }
    return { ...base, state }
  }

  function createBaseDir(): void {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', BASE_ID), { recursive: true })
  }

  it('enqueues a reindex for a restored base whose directory exists', async () => {
    createBaseDir()

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: true, enqueuedBaseIds: [BASE_ID] })
    expect(reindexItems).toHaveBeenCalledWith(BASE_ID, [ITEM_ID])
  })

  it('skips a base this device has no directory for', async () => {
    // Coverage counts it as missing and discloses it; enqueuing a reindex over
    // content that is not here would only manufacture failures.
    const outcome = await runPostPromotionWork(() => true)

    expect(outcome.enqueuedBaseIds).toEqual([])
    expect(reindexItems).not.toHaveBeenCalled()
  })

  it('skips a base whose index already exists, so later boots do not re-enqueue', async () => {
    createBaseDir()
    // Cross-boot idempotency without marker state: the journal survives until
    // acknowledgement, which may be several boots away.
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', BASE_ID, '.cherry'), { recursive: true })
    writeFileSync(join(userData, 'Data', 'KnowledgeBase', BASE_ID, '.cherry', 'index.sqlite'), 'INDEX')

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome.enqueuedBaseIds).toEqual([])
    expect(reindexItems).not.toHaveBeenCalled()
  })

  it('skips a base with no completed root items', async () => {
    createBaseDir()
    dbh.db.delete(knowledgeItemTable).run()

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome.enqueuedBaseIds).toEqual([])
  })

  it.each(['failed', 'prepared'] as const)('does nothing when the last restore is %s', async (state) => {
    createBaseDir()
    writeRestoreJournalV2(journal(state))

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome).toEqual({ ran: false, enqueuedBaseIds: [] })
    expect(reindexItems).not.toHaveBeenCalled()
  })

  it('stops enqueuing when a shutdown arrives mid-flight', async () => {
    createBaseDir()

    const outcome = await runPostPromotionWork(() => false)

    expect(outcome.enqueuedBaseIds).toEqual([])
    expect(reindexItems).not.toHaveBeenCalled()
  })

  it('isolates a failing base instead of abandoning the rest', async () => {
    createBaseDir()
    reindexItems.mockRejectedValueOnce(new Error('base is blocked'))

    const outcome = await runPostPromotionWork(() => true)

    expect(outcome.ran).toBe(true)
    expect(outcome.enqueuedBaseIds).toEqual([])
  })
})
