import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { insertWithOrderKey } from '@data/services/utils/orderKey'
import { DEFAULT_ASSISTANT_SEED, getDefaultAssistantNameForLocale } from '@shared/data/presets/defaultAssistant'
import { and, eq, isNull } from 'drizzle-orm'
import { app } from 'electron'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class DefaultAssistantSeeder implements ISeeder {
  readonly name = 'defaultAssistant'
  readonly description = 'Insert the default assistant and an empty topic for new users'
  readonly executionPolicy = 'bootstrap-only' as const
  readonly version: string

  constructor() {
    this.version = hashObject({
      assistant: DEFAULT_ASSISTANT_SEED,
      topic: { name: '', empty: true },
      freshGuard: 'bootstrap-only; no active assistant/topic/message',
      localizedName: 'preferredSystemLanguages[0]; zh=>Cherry 助手; other=>Cherry Assistant'
    })
  }

  run(db: DbType): void {
    db.transaction((tx) => {
      if (!this.isFreshUserDatabase(tx)) {
        return
      }

      const insertValues = {
        ...DEFAULT_ASSISTANT_SEED,
        name: getDefaultAssistantNameForLocale(this.getPreferredSystemLanguage()),
        settings: { ...DEFAULT_ASSISTANT_SEED.settings }
      } satisfies Omit<typeof assistantTable.$inferInsert, 'orderKey'>

      const assistant = insertWithOrderKey(tx, assistantTable, insertValues, {
        pkColumn: assistantTable.id,
        scope: isNull(assistantTable.deletedAt)
      })

      const topic = insertWithOrderKey(
        tx,
        topicTable,
        { name: '', assistantId: assistant.id as string, activeNodeId: null },
        { pkColumn: topicTable.id, scope: isNull(topicTable.deletedAt) }
      )

      messageService.createRootMessageTx(tx, topic.id as string)
    })
  }

  private getPreferredSystemLanguage(): string | undefined {
    try {
      return app.getPreferredSystemLanguages()[0]
    } catch {
      return undefined
    }
  }

  private isFreshUserDatabase(tx: Pick<DbType, 'select'>): boolean {
    const [assistant] = tx
      .select({ id: assistantTable.id })
      .from(assistantTable)
      .where(isNull(assistantTable.deletedAt))
      .limit(1)
      .all()
    if (assistant) return false

    const [topic] = tx.select({ id: topicTable.id }).from(topicTable).where(isNull(topicTable.deletedAt)).limit(1).all()
    if (topic) return false

    const [message] = tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .leftJoin(topicTable, eq(messageTable.topicId, topicTable.id))
      .where(and(isNull(messageTable.deletedAt), isNull(topicTable.deletedAt)))
      .limit(1)
      .all()
    return !message
  }
}
