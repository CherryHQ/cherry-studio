import { replayMigration, setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { jobTable } from '@data/db/schemas/job'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { FileItemDataSchema } from '@shared/data/types/knowledge'

// A conversion Knowledge started before the recovery column existed must be abandoned at restart like one
// started after it; every other job keeps following its handler.
describe('knowledge conversion recovery backfill (migration 0029)', () => {
  const dbh = setupTestDatabase()

  it('abandons only the unfinished conversions of knowledge items', () => {
    const base = new KnowledgeBaseService().create({ name: 'Base' })
    const [item] = dbh.db
      .insert(knowledgeItemTable)
      .values({
        baseId: base.id,
        type: 'file',
        data: FileItemDataSchema.parse({ source: '/import/report.pdf', relativePath: 'report.pdf' }),
        status: 'processing'
      })
      .returning()
      .all()
    const conversion = (dataId: string, feature = 'document_to_markdown') => ({
      feature,
      file: { kind: 'path', path: '/kb/raw/report.pdf' },
      output: { kind: 'path', path: '/kb/raw/report.md' },
      context: { dataId },
      processorId: 'mineru'
    })
    const rows: Array<[id: string, type: string, status: string, input: unknown]> = [
      ['knowledge-running', 'file-processing.remote-poll', 'running', conversion(item.id)],
      ['knowledge-pending', 'file-processing.background-local', 'pending', conversion(item.id)],
      ['knowledge-delayed', 'file-processing.background', 'delayed', conversion(item.id)],
      ['knowledge-completed', 'file-processing.remote-poll', 'completed', conversion(item.id)],
      ['other-caller', 'file-processing.remote-poll', 'running', conversion('external-task')],
      ['other-feature', 'file-processing.background', 'running', conversion(item.id, 'image_to_text')]
    ]
    dbh.db
      .insert(jobTable)
      .values(rows.map(([id, type, status, input]) => ({ id, type, status, queue: 'q', scheduledAt: 1, input })))
      .run()
    dbh.sqlite.exec('ALTER TABLE job DROP COLUMN recovery')

    replayMigration(dbh, '0029_sloppy_pandemic')

    const recovery = Object.fromEntries(
      dbh.db
        .select({ id: jobTable.id, recovery: jobTable.recovery })
        .from(jobTable)
        .all()
        .map((row) => [row.id, row.recovery])
    )
    expect(recovery).toEqual({
      'knowledge-running': 'abandon',
      'knowledge-pending': 'abandon',
      'knowledge-delayed': 'abandon',
      'knowledge-completed': null,
      'other-caller': null,
      'other-feature': null
    })
  })
})
