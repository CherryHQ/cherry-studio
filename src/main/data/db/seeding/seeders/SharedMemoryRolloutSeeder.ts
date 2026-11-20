import { sql } from 'drizzle-orm'

import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType, ISeeder } from '@data/db/types'

/** Capture the existing topic identities before shared memory is available on an upgraded install. */
export class SharedMemoryRolloutSeeder implements ISeeder {
  readonly name = 'sharedMemoryRollout'
  readonly version = '2'
  readonly description = 'Baseline Assistant conversations at shared-memory rollout'

  run(db: DbType): void {
    const now = Date.now()
    // Preview databases can already contain exposed transcripts. Preserve their existing isolation rules.
    db.run(sql`
      INSERT INTO ${appStateTable} (key, value, description, created_at, updated_at)
      SELECT 'memory:runtime:' || json_array('topic', id, 'shared', ''),
             json_quote('never-exposed'), 'Conversation predates shared memory', ${now}, ${now}
      FROM ${topicTable}
      WHERE EXISTS (SELECT 1 FROM ${appStateTable} WHERE key = 'seedRunner:bootstrapCompleted')
        AND NOT EXISTS (SELECT 1 FROM ${appStateTable} WHERE key = 'seed:sharedMemoryRollout' OR key GLOB 'memory:runtime:*')
        AND NOT EXISTS (SELECT 1 FROM ${assistantTable} WHERE json_type(settings, '$.enableSharedMemory') IS NOT NULL)
    `)

    // A previous Assistant may have seen memory even when the current one never did.
    // Differing protection fingerprints cannot establish a single safe baseline for the transcript.
    db.run(sql`
      WITH legacy AS (
        SELECT CASE WHEN json_valid(substr(key, length('memory:runtime:') + 1)) THEN substr(key, length('memory:runtime:') + 1) END AS owner,
               nullif(value, json_quote('never-exposed')) AS exposure
        FROM ${appStateTable} WHERE key LIKE 'memory:runtime:["assistant",%'
      )
      INSERT INTO ${appStateTable} (key, value, description, created_at, updated_at)
      SELECT 'memory:runtime:' || json_array('topic', topic.id, 'shared', ''),
             CASE WHEN count(DISTINCT exposure) > 1 THEN json_quote('isolation-required')
                  ELSE coalesce(min(exposure), json_quote('never-exposed')) END,
             'Conversation shared memory isolation boundary', ${now}, ${now}
      FROM legacy JOIN ${topicTable} AS topic ON topic.id = json_extract(owner, '$[2]')
      WHERE json_extract(owner, '$[3]') = 'shared'
      GROUP BY topic.id
      HAVING count(exposure) > 0 OR max(json_extract(owner, '$[1]') = topic.assistant_id)
      ON CONFLICT(key) DO NOTHING
    `)
  }
}
