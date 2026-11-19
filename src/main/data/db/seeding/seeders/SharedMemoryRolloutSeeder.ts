import { sql } from 'drizzle-orm'

import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType, ISeeder } from '@data/db/types'

/** Capture the existing topic identities before shared memory is available on an upgraded install. */
export class SharedMemoryRolloutSeeder implements ISeeder {
  readonly name = 'sharedMemoryRollout'
  readonly version = '1'
  readonly description = 'Baseline Assistant conversations at shared-memory rollout'

  run(db: DbType): void {
    const now = Date.now()
    // Preview databases can already contain exposed transcripts. Preserve their existing isolation rules.
    db.run(sql`
      INSERT INTO ${appStateTable} (key, value, description, created_at, updated_at)
      SELECT 'memory:runtime:' || json_array('assistant', assistant_id, id, 'shared', ''),
             json_quote('never-exposed'), 'Conversation predates shared memory', ${now}, ${now}
      FROM ${topicTable}
      WHERE assistant_id IS NOT NULL AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM ${appStateTable} WHERE key = 'seedRunner:bootstrapCompleted')
        AND NOT EXISTS (SELECT 1 FROM ${appStateTable} WHERE key GLOB 'memory:runtime:*')
        AND NOT EXISTS (SELECT 1 FROM ${assistantTable} WHERE json_type(settings, '$.enableSharedMemory') IS NOT NULL)
    `)
  }
}
