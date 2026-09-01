import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
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
  readonly version = '2'
  readonly description = 'Backfill automatic cleanup for references created by the one-shot v2 migration'

  run(db: DbType): void {
    const completedAt = readMigrationV2CompletedAt(db)
    if (completedAt === undefined) return

    // 0006 backfilled durable refs for databases that already contained Agent
    // messages. The one-shot v1 -> v2 import runs after schema migrations, so
    // its messages arrived too late for that SQL migration. Recreate only the
    // refs whose message and file both predate the recorded migration boundary.
    db.transaction((tx) => {
      tx.run(sql`
      INSERT INTO ${agentSessionMessageFileRefTable}
        (id, file_entry_id, source_id, role, created_at, updated_at)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2) || '-' ||
          substr('89ab', abs(random() % 4) + 1, 1) ||
          substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
        json_extract(part.value, '$.providerMetadata.cherry.fileEntryId'),
        message.id,
        'attachment',
        message.created_at,
        message.updated_at
      FROM ${agentSessionMessageTable} AS message
      JOIN json_each(json_extract(message.data, '$.parts')) AS part
      JOIN ${fileEntryTable} AS file
        ON file.id = json_extract(part.value, '$.providerMetadata.cherry.fileEntryId')
      WHERE json_extract(part.value, '$.type') = 'file'
        AND message.created_at <= ${completedAt}
        AND file.created_at <= ${completedAt}
      GROUP BY message.id, json_extract(part.value, '$.providerMetadata.cherry.fileEntryId')
      ON CONFLICT (file_entry_id, source_id, role) DO NOTHING
      `)

      tx.run(sql`
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
        AND updated_at <= ${completedAt}
        AND id IN (SELECT file_entry_id FROM migrated_file_ref)
      `)
    })
  }
}
