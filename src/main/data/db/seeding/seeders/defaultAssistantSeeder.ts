import { assistantTable } from '@data/db/schemas/assistant'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_PAYLOAD } from '@shared/data/types/assistant'
import { eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Idempotent insert of the renderer's id='default' assistant row.
 * Payload is shared with `AssistantMigrator.execute()` via {@link DEFAULT_ASSISTANT_PAYLOAD}.
 */
export class DefaultAssistantSeeder implements ISeeder {
  readonly name = 'defaultAssistant'
  readonly description = 'Insert the renderer-side default assistant row'
  readonly version: string

  constructor() {
    this.version = hashObject(DEFAULT_ASSISTANT_PAYLOAD)
  }

  async run(db: DbType): Promise<void> {
    const existing = await db
      .select({ id: assistantTable.id })
      .from(assistantTable)
      .where(eq(assistantTable.id, DEFAULT_ASSISTANT_ID))
      .limit(1)

    if (existing.length > 0) return

    await db.insert(assistantTable).values(DEFAULT_ASSISTANT_PAYLOAD)
  }
}
