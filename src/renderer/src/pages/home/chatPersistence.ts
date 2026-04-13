import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { mapLegacyTopicToDto } from '@renderer/services/AssistantService'
import type { Topic } from '@renderer/types'
import { ErrorCode } from '@shared/data/api'

const logger = loggerService.withContext('HomeChatPersistence')

function isNotFoundError(error: unknown): boolean {
  return error instanceof Object && 'code' in error && error.code === ErrorCode.NOT_FOUND
}

/**
 * Ensure a topic exists in SQLite before sending a message.
 * If it doesn't exist, create it via DataApi using the legacy topic DTO mapping.
 */
export async function ensureChatTopicPersisted(topic: Pick<Topic, 'id' | 'name' | 'assistantId'>): Promise<void> {
  try {
    await dataApiService.get(`/topics/${topic.id}`)
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await dataApiService.post('/topics', { body: mapLegacyTopicToDto(topic as Topic) })
  logger.info('Persisted topic to SQLite', { topicId: topic.id })
}
