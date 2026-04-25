import { assistantTable } from '@data/db/schemas/assistant'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Ensures the renderer's "default assistant" row exists in the DB on every
 * fresh install. The id is the stable {@link DEFAULT_ASSISTANT_ID} so
 * `useAssistantApiById(DEFAULT_ASSISTANT_ID)` always resolves on first run.
 *
 * Idempotent: if the row already exists (matched by id) this seeder is a
 * no-op. The hashed `version` only changes when the seeded payload below
 * does, so the seed runner re-applies it on payload changes only.
 */
export class DefaultAssistantSeeder implements ISeeder {
  readonly name = 'defaultAssistant'
  readonly description = 'Insert the renderer-side default assistant row'
  readonly version: string

  private static readonly seedPayload = {
    id: DEFAULT_ASSISTANT_ID,
    // TODO: i18n
    name: 'Default Assistant',
    prompt: '',
    emoji: '🌟',
    description: '',
    settings: DEFAULT_ASSISTANT_SETTINGS
  }

  constructor() {
    this.version = hashObject(DefaultAssistantSeeder.seedPayload)
  }

  async run(db: DbType): Promise<void> {
    const existing = await db
      .select({ id: assistantTable.id })
      .from(assistantTable)
      .where(eq(assistantTable.id, DEFAULT_ASSISTANT_ID))
      .limit(1)

    if (existing.length > 0) return

    await db.insert(assistantTable).values(DefaultAssistantSeeder.seedPayload)
  }
}
