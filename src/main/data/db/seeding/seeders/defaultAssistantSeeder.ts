import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { CHERRYAI_DEFAULT_MODEL_SEEDER_NAME } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { SEED_KEY_PREFIX } from '@data/db/seeding/SeedRunner'
import { insertWithOrderKey } from '@data/services/utils/orderKey'
import { DEFAULT_ASSISTANT_SEED } from '@shared/data/presets/default-assistant'
import { and, eq, isNull, like, ne } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const CHERRYAI_DEFAULT_MODEL_SEED_JOURNAL_KEY = `${SEED_KEY_PREFIX}${CHERRYAI_DEFAULT_MODEL_SEEDER_NAME}` as const
const SEED_JOURNAL_KEY_PATTERN = `${SEED_KEY_PREFIX}%` as const

export class DefaultAssistantSeeder implements ISeeder {
  readonly name = 'defaultAssistant'
  readonly description = 'Insert the default assistant for new users'
  readonly version: string

  constructor() {
    this.version = hashObject({
      assistant: DEFAULT_ASSISTANT_SEED,
      freshGuard: 'no non-dependency seed journal and no active assistant/topic/message'
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction(async (tx) => {
      if (!(await this.isFreshUserDatabase(tx))) {
        return
      }

      const insertValues = {
        ...DEFAULT_ASSISTANT_SEED,
        settings: { ...DEFAULT_ASSISTANT_SEED.settings }
      } satisfies Omit<typeof assistantTable.$inferInsert, 'orderKey'>

      await insertWithOrderKey(tx, assistantTable, insertValues, {
        pkColumn: assistantTable.id,
        scope: isNull(assistantTable.deletedAt)
      })
    })
  }

  private async isFreshUserDatabase(tx: Pick<DbType, 'select'>): Promise<boolean> {
    const [seedJournal] = await tx
      .select({ key: appStateTable.key })
      .from(appStateTable)
      .where(
        and(
          like(appStateTable.key, SEED_JOURNAL_KEY_PATTERN),
          ne(appStateTable.key, CHERRYAI_DEFAULT_MODEL_SEED_JOURNAL_KEY)
        )
      )
      .limit(1)
    if (seedJournal) return false

    const [assistant] = await tx
      .select({ id: assistantTable.id })
      .from(assistantTable)
      .where(isNull(assistantTable.deletedAt))
      .limit(1)
    if (assistant) return false

    const [topic] = await tx.select({ id: topicTable.id }).from(topicTable).where(isNull(topicTable.deletedAt)).limit(1)
    if (topic) return false

    const [message] = await tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .leftJoin(topicTable, eq(messageTable.topicId, topicTable.id))
      .where(and(isNull(messageTable.deletedAt), isNull(topicTable.deletedAt)))
      .limit(1)
    return !message
  }
}
