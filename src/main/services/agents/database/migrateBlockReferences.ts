/**
 * Migration script to fix data inconsistency between message.blocks (ID references)
 * and the actual blocks array in AgentPersistedMessage.
 *
 * Problem: Some blocks (especially TodoWrite) exist in the `blocks` array but their
 * IDs are NOT in `message.blocks`. This causes issues when trying to delete blocks
 * by ID since the deletion logic checks `message.blocks`.
 *
 * Solution: Iterate through all session_messages and add missing block IDs to message.blocks.
 */

import { loggerService } from '@logger'
import type { AgentPersistedMessage } from '@types'
import { asc, eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { findMissingBlockIds, mergeBlockReferences, type MigrationResult } from './migrateBlockReferences.utils'
import type * as schema from './schema'
import { sessionMessagesTable } from './schema'

const logger = loggerService.withContext('MigrateBlockReferences')

// Re-export pure functions and types for external use
export { findMissingBlockIds, mergeBlockReferences, type MigrationResult } from './migrateBlockReferences.utils'

/**
 * Run the block references migration with an externally provided database instance.
 * This is used by DataMigrationService to avoid circular dependency with DatabaseManager.
 */
export async function runBlockReferencesMigration(database: LibSQLDatabase<typeof schema>): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalMessages: 0,
    messagesFixed: 0,
    blockReferencesAdded: 0,
    errors: []
  }

  try {
    const rows = await database.select().from(sessionMessagesTable).orderBy(asc(sessionMessagesTable.created_at))

    result.totalMessages = rows.length
    logger.info(`Starting migration: ${rows.length} messages to process`)

    for (const row of rows) {
      if (!row?.content) continue

      try {
        const parsed = JSON.parse(row.content) as AgentPersistedMessage | undefined
        if (!parsed?.message?.id) continue

        const messageBlocks = parsed.message.blocks ?? []
        const blocks = parsed.blocks ?? []

        const missingIds = findMissingBlockIds(messageBlocks, blocks)

        if (missingIds.length === 0) continue

        logger.info(`Fixing message ${parsed.message.id}: adding ${missingIds.length} missing block references`)

        parsed.message.blocks = mergeBlockReferences(messageBlocks, missingIds)

        const serializedPayload = JSON.stringify(parsed)

        await database
          .update(sessionMessagesTable)
          .set({
            content: serializedPayload,
            updated_at: new Date().toISOString()
          })
          .where(eq(sessionMessagesTable.id, row.id))

        result.messagesFixed++
        result.blockReferencesAdded += missingIds.length
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        result.errors.push({
          sessionId: row.session_id,
          messageId: row.id.toString(),
          error: errorMessage
        })
        logger.warn(`Failed to process message ${row.id}: ${errorMessage}`)
      }
    }

    logger.info(
      `Migration complete: ${result.messagesFixed} messages fixed, ${result.blockReferencesAdded} block references added`
    )

    return result
  } catch (error) {
    logger.error('Migration failed', error as Error)
    throw error
  }
}
