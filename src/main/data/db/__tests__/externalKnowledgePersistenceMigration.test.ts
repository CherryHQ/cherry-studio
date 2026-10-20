import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod'

import { applyMigrations } from '@data/db/applyMigrations'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

const BASE = '11111111-1111-4111-8111-111111111111'
const CONNECTION = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const ITEM = '0198f3f2-7d1a-7abc-8def-123456789ab3'
const JOB = '0198f3f2-7d1a-7abc-8def-123456789ab4'
const SCHEDULE = '33333333-3333-4333-8333-333333333333'

describe('external knowledge persistence migrate-forward', () => {
  const baseline = mkdtempSync(join(tmpdir(), 'cs-external-baseline-'))
  const migrations = resolveMigrationsPath()
  const journal = z
    .object({
      entries: z.array(z.object({ tag: z.string() }).passthrough())
    })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')))
  const baselineIndex = journal.entries.findIndex((entry) => entry.tag === '0029_sticky_human_robot')
  if (baselineIndex < 0) throw new Error('External knowledge baseline migration is missing')
  const entries = journal.entries.slice(0, baselineIndex + 1)
  mkdirSync(join(baseline, 'meta'))
  writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const { tag } of entries) copyFileSync(join(migrations, `${tag}.sql`), join(baseline, `${tag}.sql`))

  const dbh = setupTestDatabase({ migrationsFolder: baseline })
  afterAll(() => rmSync(baseline, { recursive: true, force: true }))

  it('removes unused metadata without losing ownership, summaries or job references', () => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: BASE, name: 'Existing', orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
      .run()
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION,
        provider: 'feishu',
        appId: 'app-existing',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'credential-existing'
      })
      .run()
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: SCHEDULE,
        type: 'knowledge.sync-external-source',
        trigger: { kind: 'cron', expr: '0 3 * * *', timezone: 'Asia/Shanghai' },
        jobInputTemplate: { sourceId: SOURCE },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()
    dbh.db
      .insert(jobTable)
      .values({
        id: JOB,
        type: 'knowledge.sync-external-source',
        status: 'running',
        queue: `base.${BASE}`,
        scheduleId: SCHEDULE,
        scheduledAt: 1000,
        input: { sourceId: SOURCE, revision: 7 }
      })
      .run()
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: SOURCE,
        baseId: BASE,
        connectionId: CONNECTION,
        provider: 'feishu',
        tenantId: 'tenant-existing',
        spaceId: 'space-existing',
        scope: { kind: 'node', nodeId: 'node-existing' },
        name: 'Existing wiki',
        state: 'paused',
        revision: 7,
        scheduleId: SCHEDULE,
        activeJobId: JOB,
        lastTrigger: 'scheduled',
        lastStartedAt: 1000,
        lastFinishedAt: 2000,
        lastOutcome: 'completed-with-warnings',
        lastIndexedCount: 1,
        lastUnchangedCount: 2,
        lastSkippedCount: 3,
        lastWarningCount: 1,
        lastErrorSummary: 'One document unavailable',
        lastSuccessfulSyncAt: 2000
      })
      .run()
    dbh.sqlite.prepare('UPDATE external_knowledge_source SET last_scanned_count = 6 WHERE id = ?').run(SOURCE)
    for (const [id, status] of [
      [ITEM, 'completed'],
      ['staging-item', 'deleting']
    ] as const) {
      dbh.db
        .insert(knowledgeItemTable)
        .values({
          id,
          baseId: BASE,
          type: 'external',
          status,
          data: {
            source: 'Existing wiki',
            title: 'Existing document',
            relativePath: KnowledgeRelativePathSchema.parse(`external/${id}.md`)
          }
        })
        .run()
    }
    const insertDocument = dbh.sqlite.prepare(`INSERT INTO external_knowledge_document
      (id, source_id, remote_object_id, canonical_node_id, parent_node_id, relative_breadcrumb,
       title, original_url, remote_revision, content_hash, last_seen_at, availability,
       knowledge_item_id, current_warning, created_at, updated_at)
      VALUES (?, ?, ?, 'node-existing', 'parent-existing', '["Folder","Document"]',
        'Existing document', 'https://example.feishu.cn/wiki/node-existing', 'revision-42',
        ?, 2000, ?, ?, ?, 1000, 2000)`)
    insertDocument.run('active-document', SOURCE, 'remote-active', 'hash-existing', 'active', ITEM, null)
    insertDocument.run('unavailable-document', SOURCE, 'remote-unavailable', null, 'unavailable', null, 'Denied')

    const sourceColumns = `id, base_id, connection_id, provider, tenant_id, space_id, scope, name, state,
      schedule_id, revision, active_job_id, last_trigger, last_started_at, last_finished_at, last_outcome,
      last_indexed_count, last_unchanged_count, last_skipped_count, last_warning_count,
      last_error_summary, last_successful_sync_at, created_at, updated_at`
    const documentColumns = `id, source_id, remote_object_id, title, original_url, remote_revision,
      content_hash, last_seen_at, availability, knowledge_item_id, current_warning, created_at, updated_at`
    const readPreserved = () => ({
      sources: dbh.sqlite.prepare(`SELECT ${sourceColumns} FROM external_knowledge_source ORDER BY id`).all(),
      documents: dbh.sqlite.prepare(`SELECT ${documentColumns} FROM external_knowledge_document ORDER BY id`).all(),
      connections: dbh.db.select().from(externalKnowledgeConnectionTable).all(),
      items: dbh.db.select().from(knowledgeItemTable).all(),
      jobs: dbh.db.select().from(jobTable).all(),
      schedules: dbh.db.select().from(jobScheduleTable).all()
    })
    const preserved = readPreserved()

    applyMigrations(dbh.db, migrations)
    applyMigrations(dbh.db, migrations)

    expect(readPreserved()).toEqual(preserved)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    const columns = dbh.sqlite.prepare("SELECT name FROM pragma_table_info('external_knowledge_document')").all()
    for (const name of ['canonical_node_id', 'parent_node_id', 'relative_breadcrumb']) {
      expect(columns).not.toContainEqual({ name })
    }
    expect(
      dbh.sqlite.prepare("SELECT name FROM pragma_table_info('external_knowledge_source')").all()
    ).not.toContainEqual({
      name: 'last_scanned_count'
    })
    expect(() => dbh.sqlite.prepare('DELETE FROM knowledge_item WHERE id = ?').run(ITEM)).toThrow()
    expect(() => dbh.sqlite.prepare('DELETE FROM external_knowledge_connection WHERE id = ?').run(CONNECTION)).toThrow()
    dbh.sqlite.prepare('DELETE FROM job_schedule WHERE id = ?').run(SCHEDULE)
    expect(dbh.sqlite.prepare('SELECT schedule_id FROM external_knowledge_source').get()).toEqual({ schedule_id: null })
    dbh.sqlite.prepare('DELETE FROM knowledge_base WHERE id = ?').run(BASE)
    expect(dbh.sqlite.prepare('SELECT id FROM external_knowledge_document').all()).toEqual([])
    expect(dbh.sqlite.prepare('SELECT id FROM external_knowledge_source').all()).toEqual([])
    expect(dbh.sqlite.prepare('SELECT id FROM knowledge_item').all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
  })
})
