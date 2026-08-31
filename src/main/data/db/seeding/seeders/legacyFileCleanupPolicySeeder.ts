import { fileEntryTable } from '@data/db/schemas/file'
import {
  agentSessionMessageFileRefTable,
  chatMessageFileRefTable,
  miniAppLogoFileRefTable,
  paintingFileRefTable,
  providerLogoFileRefTable
} from '@data/db/schemas/fileRelations'
import { readMigrationV2CompletedAt } from '@data/migration/v2'
import { sql } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'

/** Correct cleanup policy for file refs produced by the one-shot v2 migration. */
export class LegacyFileCleanupPolicySeeder implements ISeeder {
  readonly name = 'legacyFileCleanupPolicy'
  readonly version = '1'
  readonly description = 'Backfill automatic cleanup for references created by the one-shot v2 migration'

  run(db: DbType): void {
    const completedAt = readMigrationV2CompletedAt(db)
    if (completedAt === undefined) return

    db.run(sql`
      WITH migrated_file_ref AS (
        SELECT file_entry_id FROM ${agentSessionMessageFileRefTable}
        WHERE created_at <= ${completedAt}
        UNION
        SELECT file_entry_id FROM ${chatMessageFileRefTable}
        WHERE created_at <= ${completedAt}
        UNION
        SELECT file_entry_id FROM ${paintingFileRefTable}
        WHERE created_at <= ${completedAt}
        UNION
        SELECT file_entry_id FROM ${providerLogoFileRefTable}
        WHERE created_at <= ${completedAt}
        UNION
        SELECT file_entry_id FROM ${miniAppLogoFileRefTable}
        WHERE created_at <= ${completedAt}
      )
      UPDATE ${fileEntryTable}
      SET cleanup_policy = 'delete_when_unreferenced'
      WHERE cleanup_policy = 'manual'
        AND created_at <= ${completedAt}
        AND id IN (SELECT file_entry_id FROM migrated_file_ref)
    `)
  }
}
