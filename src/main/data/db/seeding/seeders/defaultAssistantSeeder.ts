import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { insertWithOrderKey } from '@data/services/utils/orderKey'
import { DEFAULT_ASSISTANT_SEED } from '@shared/data/presets/defaultAssistant'
import { and, eq, isNull } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class DefaultAssistantSeeder implements ISeeder {
  readonly name = 'defaultAssistant'
  readonly description = 'Insert the default assistant for new users'
  readonly executionPolicy = 'bootstrap-only' as const
  readonly version: string

  constructor() {
    this.version = hashObject({
      assistant: DEFAULT_ASSISTANT_SEED,
      freshGuard: 'bootstrap-only; no active assistant/topic/message'
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
