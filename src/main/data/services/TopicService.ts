/**
 * Topic Service - handles topic CRUD and branch switching
 *
 * Provides business logic for:
 * - Topic CRUD operations
 * - Fork from existing conversation
 * - Active node switching
 */

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'
import { and, eq, isNull } from 'drizzle-orm'

import { messageService } from './MessageService'
import { tagService } from './TagService'

const logger = loggerService.withContext('DataApi:TopicService')

function rowToTopic(row: typeof topicTable.$inferSelect): Topic {
  return {
    id: row.id,
    name: row.name,
    isNameManuallyEdited: row.isNameManuallyEdited ?? false,
    assistantId: row.assistantId,
    activeNodeId: row.activeNodeId,
    groupId: row.groupId,
    sortOrder: row.sortOrder ?? 0,
    isPinned: row.isPinned ?? false,
    pinnedOrder: row.pinnedOrder ?? 0,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class TopicService {
  /**
   * Get a topic by ID
   */
  async getById(id: string): Promise<Topic> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .select()
      .from(topicTable)
      .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }

    return rowToTopic(row)
  }

  /**
   * Create a new topic
   */
  async create(dto: CreateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    // If forking from existing node, copy the path
    if (dto.sourceNodeId) {
      // Verify source node exists (let NOT_FOUND propagate naturally)
      await messageService.getById(dto.sourceNodeId)

      // Get path from root to source node
      const path = await messageService.getPathToNode(dto.sourceNodeId)

      // Wrap fork in transaction for atomicity
      const topicId = await db.transaction(async (tx) => {
        const [topicRow] = await tx
          .insert(topicTable)
          .values({
            name: dto.name,
            assistantId: dto.assistantId,
            groupId: dto.groupId
          })
          .returning()

        const id = topicRow.id

        // Copy messages with new IDs
        const idMapping = new Map<string, string>()
        let activeNodeId: string | null = null

        for (const message of path) {
          const newParentId = message.parentId ? idMapping.get(message.parentId) || null : null

          const [messageRow] = await tx
            .insert(messageTable)
            .values({
              topicId: id,
              parentId: newParentId,
              role: message.role,
              data: message.data,
              status: message.status,
              siblingsGroupId: 0,
              modelId: message.modelId,
              traceId: null,
              stats: null
            })
            .returning()

          idMapping.set(message.id, messageRow.id)
          activeNodeId = messageRow.id
        }

        await tx.update(topicTable).set({ activeNodeId }).where(eq(topicTable.id, id))
        return id
      })

      logger.info('Created topic by forking', {
        id: topicId,
        sourceNodeId: dto.sourceNodeId,
        messageCount: path.length
      })

      return this.getById(topicId)
    } else {
      // Create empty topic using returning()
      const [row] = await db
        .insert(topicTable)
        .values({
          name: dto.name,
          assistantId: dto.assistantId,
          groupId: dto.groupId
        })
        .returning()

      logger.info('Created empty topic', { id: row.id })

      return rowToTopic(row)
    }
  }

  /**
   * Update a topic
   */
  async update(id: string, dto: UpdateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(id)

    // Build update object
    const updates: Partial<typeof topicTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.isNameManuallyEdited !== undefined) updates.isNameManuallyEdited = dto.isNameManuallyEdited
    if (dto.assistantId !== undefined) updates.assistantId = dto.assistantId
    if (dto.groupId !== undefined) updates.groupId = dto.groupId
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder
    if (dto.isPinned !== undefined) updates.isPinned = dto.isPinned
    if (dto.pinnedOrder !== undefined) updates.pinnedOrder = dto.pinnedOrder

    const [row] = await db.update(topicTable).set(updates).where(eq(topicTable.id, id)).returning()

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return rowToTopic(row)
  }

  /**
   * Delete a topic and all its messages (hard delete)
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(id)

    await db.transaction(async (tx) => {
      // Hard delete all messages first (due to foreign key)
      await tx.delete(messageTable).where(eq(messageTable.topicId, id))
      await tagService.removeEntityTags('topic', id, tx)

      // Hard delete topic
      await tx.delete(topicTable).where(eq(topicTable.id, id))
    })

    logger.info('Deleted topic', { id })
  }

  /**
   * Set the active node for a topic
   */
  async setActiveNode(topicId: string, nodeId: string): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(topicId)

    // Verify node exists and belongs to this topic
    const [message] = await db.select().from(messageTable).where(eq(messageTable.id, nodeId)).limit(1)

    if (!message || message.topicId !== topicId) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    // Update active node
    await db.update(topicTable).set({ activeNodeId: nodeId }).where(eq(topicTable.id, topicId))

    logger.info('Set active node', { topicId, nodeId })

    return { activeNodeId: nodeId }
  }
}

export const topicService = new TopicService()
