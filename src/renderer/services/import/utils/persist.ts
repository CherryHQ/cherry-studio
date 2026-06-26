import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Message } from '@renderer/types/newMessage'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'

import type { ImportResult } from '../types'

const logger = loggerService.withContext('ImportPersist')

/**
 * Build a v2 create-message DTO from a parsed v1 message. Imported messages
 * are historical, so they are persisted as `success`; the source model is
 * captured as a `modelSnapshot` so the renderer can show its badge.
 */
function toMessageDto(message: Message, blockContent: Map<string, string>, parentId: string | null): CreateMessageDto {
  const text = message.blocks.map((id) => blockContent.get(id) ?? '').join('\n\n')

  const dto: CreateMessageDto = {
    parentId,
    role: message.role,
    data: { parts: [{ type: 'text', text }] },
    status: 'success'
  }

  if (message.model) {
    dto.modelSnapshot = {
      id: message.model.id,
      name: message.model.name,
      provider: message.model.provider,
      group: message.model.group
    }
  }

  return dto
}

/**
 * Persist an import result via the v2 DataApi. Each message chains to the
 * previous one's returned id, forming a single linear branch under its topic.
 */
export async function persistImport(result: ImportResult): Promise<void> {
  const { topics, blocks, messages } = result
  const blockContent = new Map(blocks.map((block) => [block.id, block.content]))

  for (const topic of topics) {
    const createdTopic = await dataApiService.post('/topics', {
      body: { name: topic.name, assistantId: topic.assistantId }
    })

    let parentId: string | null = null
    for (const message of topic.messages) {
      const created = await dataApiService.post(`/topics/${createdTopic.id}/messages`, {
        body: toMessageDto(message, blockContent, parentId)
      })
      parentId = created.id
    }
  }

  logger.info(`Persisted import: ${topics.length} topics, ${messages.length} messages`)
}
