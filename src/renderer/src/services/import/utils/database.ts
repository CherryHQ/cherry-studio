import { loggerService } from '@logger'
import db from '@renderer/databases'

import type { ImportResult } from '../types'

const logger = loggerService.withContext('ImportDatabase')

/**
 * Save import result to database
 * Handles saving topics, messages, and message blocks in a transaction
 */
export async function saveImportToDatabase(result: ImportResult): Promise<void> {
  const { topics, messages, blocks } = result

  logger.info(`Saving import: ${topics.length} topics, ${messages.length} messages, ${blocks.length} blocks`)

  await db.transaction('rw', db.topics, db.message_blocks, async () => {
    // Save all message blocks
    if (blocks.length > 0) {
      await db.message_blocks.bulkAdd(blocks)
      logger.info(`Saved ${blocks.length} message blocks`)
    }

    // Save all topics with messages
    for (const topic of topics) {
      const topicMessages = messages.filter((m) => m.topicId === topic.id)
      await db.topics.add({
        id: topic.id,
        messages: topicMessages
      })
    }
    logger.info(`Saved ${topics.length} topics`)
  })
}
