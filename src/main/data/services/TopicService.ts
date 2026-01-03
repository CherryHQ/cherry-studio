/**
 * Topic Service - handles topic CRUD and branch switching
 *
 * Provides business logic for:
 * - Topic CRUD operations
 * - Fork from existing conversation
 * - Active node switching
 */

import { dbService } from '@data/db/DbService'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'
import { eq } from 'drizzle-orm'

import { messageService } from './MessageService'

const logger = loggerService.withContext('TopicService')

/**
 * Convert database row to Topic entity
 */
function rowToTopic(row: typeof topicTable.$inferSelect): Topic {
  return {
    id: row.id,
    name: row.name,
    isNameManuallyEdited: row.isNameManuallyEdited ?? false,
    assistantId: row.assistantId,
    assistantMeta: row.assistantMeta,
    prompt: row.prompt,
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
  private static instance: TopicService

  private constructor() {}

  public static getInstance(): TopicService {
    if (!TopicService.instance) {
      TopicService.instance = new TopicService()
    }
    return TopicService.instance
  }

  /**
   * Get a topic by ID
   */
  async getById(id: string): Promise<Topic> {
    const db = dbService.getDb()

    const [row] = await db.select().from(topicTable).where(eq(topicTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }

    return rowToTopic(row)
  }

  /**
   * Create a new topic
   */
  async create(dto: CreateTopicDto): Promise<Topic> {
    const db = dbService.getDb()

    // If forking from existing node, copy the path
    if (dto.sourceNodeId) {
      // Verify source node exists
      try {
        await messageService.getById(dto.sourceNodeId)
      } catch {
        throw DataApiErrorFactory.notFound('Message', dto.sourceNodeId)
      }

      // Get path from root to source node
      const path = await messageService.getPathToNode(dto.sourceNodeId)

      // Create new topic first using returning() to get the id
      const [topicRow] = await db
        .insert(topicTable)
        .values({
          name: dto.name,
          assistantId: dto.assistantId,
          assistantMeta: dto.assistantMeta,
          prompt: dto.prompt,
          groupId: dto.groupId
        })
        .returning()

      const topicId = topicRow.id

      // Copy messages with new IDs using returning()
      const idMapping = new Map<string, string>()
      let activeNodeId: string | null = null

      for (const message of path) {
        const newParentId = message.parentId ? idMapping.get(message.parentId) || null : null

        const [messageRow] = await db
          .insert(messageTable)
          .values({
            topicId,
            parentId: newParentId,
            role: message.role,
            data: message.data,
            status: message.status,
            siblingsGroupId: 0, // Simplify multi-model to normal node
            assistantId: message.assistantId,
            assistantMeta: message.assistantMeta,
            modelId: message.modelId,
            modelMeta: message.modelMeta,
            traceId: null,
            stats: null
          })
          .returning()

        idMapping.set(message.id, messageRow.id)
        activeNodeId = messageRow.id
      }

      // Update topic with active node
      await db.update(topicTable).set({ activeNodeId }).where(eq(topicTable.id, topicId))

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
          assistantMeta: dto.assistantMeta,
          prompt: dto.prompt,
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
    const db = dbService.getDb()

    // Verify topic exists
    await this.getById(id)

    // Build update object
    const updates: Partial<typeof topicTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.isNameManuallyEdited !== undefined) updates.isNameManuallyEdited = dto.isNameManuallyEdited
    if (dto.assistantId !== undefined) updates.assistantId = dto.assistantId
    if (dto.assistantMeta !== undefined) updates.assistantMeta = dto.assistantMeta
    if (dto.prompt !== undefined) updates.prompt = dto.prompt
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
    const db = dbService.getDb()

    // Verify topic exists
    await this.getById(id)

    // Hard delete all messages first (due to foreign key)
    await db.delete(messageTable).where(eq(messageTable.topicId, id))

    // Hard delete topic
    await db.delete(topicTable).where(eq(topicTable.id, id))

    logger.info('Deleted topic', { id })
  }

  /**
   * Set the active node for a topic
   */
  async setActiveNode(topicId: string, nodeId: string): Promise<{ activeNodeId: string }> {
    const db = dbService.getDb()

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

export const topicService = TopicService.getInstance()
