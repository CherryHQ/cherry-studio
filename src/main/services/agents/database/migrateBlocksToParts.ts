/**
 * Migration: Convert Agent session messages from blocks[] to parts[] format.
 *
 * Old format (AgentPersistedMessage):
 *   { message: { blocks: string[], ... }, blocks: MessageBlock[] }
 *
 * New format:
 *   { message: { data: { parts: CherryMessagePart[] }, blocks: [], ... }, blocks: [] }
 *
 * Reuses `transformBlocksToParts` from the v2 ChatMappings migration — same
 * block→part conversion logic used for normal chat messages.
 */

import { loggerService } from '@logger'
import { transformBlocksToParts } from '@main/data/migration/v2/migrators/mappings/ChatMappings'
import { asc, eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type * as schema from './schema'
import { sessionMessagesTable } from './schema'

const logger = loggerService.withContext('MigrateBlocksToParts')

export interface BlocksToPartsMigrationResult {
  totalMessages: number
  messagesConverted: number
  messagesSkipped: number
  errors: Array<{ rowId: number; error: string }>
}

export async function runBlocksToPartsMigration(
  database: LibSQLDatabase<typeof schema>
): Promise<BlocksToPartsMigrationResult> {
  const result: BlocksToPartsMigrationResult = {
    totalMessages: 0,
    messagesConverted: 0,
    messagesSkipped: 0,
    errors: []
  }

  const rows = await database.select().from(sessionMessagesTable).orderBy(asc(sessionMessagesTable.created_at))
  result.totalMessages = rows.length
  logger.info(`Blocks→Parts migration: processing ${rows.length} messages`)

  for (const row of rows) {
    if (!row?.content) continue

    try {
      const parsed = JSON.parse(row.content)
      const blocks = parsed?.blocks ?? []
      const message = parsed?.message

      if (!message) continue

      // Already migrated or nothing to convert
      if (blocks.length === 0) {
        result.messagesSkipped++
        continue
      }

      // Reuse the v2 ChatMappings converter (handles all block types, citations, searchableText)
      const { parts } = transformBlocksToParts(blocks)

      // Update message: set data.parts, clear blocks
      message.data = { ...message.data, parts }
      message.blocks = []
      parsed.blocks = []

      await database
        .update(sessionMessagesTable)
        .set({ content: JSON.stringify(parsed), updated_at: new Date().toISOString() })
        .where(eq(sessionMessagesTable.id, row.id))

      result.messagesConverted++
    } catch (error) {
      result.errors.push({ rowId: row.id, error: error instanceof Error ? error.message : String(error) })
      logger.warn(`Failed to migrate message ${row.id}`, { error })
    }
  }

  logger.info(
    `Blocks→Parts migration complete: ${result.messagesConverted} converted, ${result.messagesSkipped} skipped, ${result.errors.length} errors`
  )
  return result
}
