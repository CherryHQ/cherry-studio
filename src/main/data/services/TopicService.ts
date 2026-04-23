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
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import { messageService } from './MessageService'
import { tagService } from './TagService'
import { timestampToISO } from './utils/rowMappers'

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
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
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
   * List topics (excludes soft-deleted rows).
   * Order: pinned first, then pinned order, sort order, then most recently updated.
   * TODO: add condition
   */
  async list(assistantId?: string): Promise<Topic[]> {
    const db = application.get('DbService').getDb()

    const where = assistantId
      ? and(eq(topicTable.assistantId, assistantId), isNull(topicTable.deletedAt))
      : isNull(topicTable.deletedAt)

    const rows = await db
      .select()
      .from(topicTable)
      .where(where)
      .orderBy(
        desc(topicTable.isPinned),
        asc(topicTable.pinnedOrder),
        asc(topicTable.sortOrder),
        desc(topicTable.updatedAt)
      )

    return rows.map(rowToTopic)
  }

  /**
   * Create a new topic.
   *
   * When `sourceNodeId` is set, the new topic **shares** the ancestor chain
   * leading to that message — no message copies are made. The new topic
   * simply records `activeNodeId = sourceNodeId`, and `getBranchMessages`
   * walks `parent_id` across topics to reconstruct the shared history. The
   * caller's first new message in the forked topic will attach to the shared
   * node, diverging the tree from that point on.
   *
   * Rationale: copying the path produced two drawbacks — (1) storage grew
   * quadratically with deep forks, and (2) edits in the source topic never
   * showed up in forks, which is surprising when users think of "branch as
   * continuation". Shared references avoid both.
   */
  async create(dto: CreateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    let activeNodeId: string | null = null
    if (dto.sourceNodeId) {
      // Verify source exists (surface NOT_FOUND cleanly instead of FK violation)
      await messageService.getById(dto.sourceNodeId)
      activeNodeId = dto.sourceNodeId
    }

    const [row] = await db
      .insert(topicTable)
      .values({
        name: dto.name,
        assistantId: dto.assistantId,
        groupId: dto.groupId,
        activeNodeId
      })
      .returning()

    if (dto.sourceNodeId) {
      logger.info('Created forked topic', { id: row.id, sourceNodeId: dto.sourceNodeId })
    } else {
      logger.info('Created empty topic', { id: row.id })
    }

    return rowToTopic(row)
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
   *
   * TODO: Clean up associated files (images, attachments) from disk.
   * Previously handled by renderer-side `safeDeleteFiles` via Dexie blocks.
   * Now that messages live in SQLite, file cleanup should happen here
   * by scanning message data for file references before deletion.
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(id)

    await db.transaction(async (tx) => {
      // Hard delete all messages first (due to foreign key)
      await tx.delete(messageTable).where(eq(messageTable.topicId, id))
      await tagService.purgeForEntity(tx, 'topic', id)

      // Hard delete topic
      await tx.delete(topicTable).where(eq(topicTable.id, id))
    })

    logger.info('Deleted topic', { id })
  }

  /**
   * Set the active node for a topic.
   *
   * Two modes:
   *   - `descend: true` (navigator semantics) — walk down from `nodeId` to
   *     any leaf and pin that as active. Used when switching between sibling
   *     branches where the user wants to see the full follow-up chain.
   *   - `descend: false` (default, branch semantics) — pin `nodeId` itself
   *     as active. The conversation view truncates at that node; the user's
   *     next message becomes the new child and the tree forks from here.
   *
   * `getBranchMessages` walks parent_id upward, so the leaf vs. non-leaf
   * choice decides whether follow-up descendants show in the scroll view.
   */
  async setActiveNode(
    topicId: string,
    nodeId: string,
    options: { descend?: boolean } = {}
  ): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()
    const { descend = false } = options

    // Verify topic exists
    await this.getById(topicId)

    // Verify node exists within this topic.
    const [message] = await db.select().from(messageTable).where(eq(messageTable.id, nodeId)).limit(1)

    if (!message || message.topicId !== topicId) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    let targetId = nodeId
    if (descend) {
      // Pick any leaf in the subtree rooted at `nodeId`. Multi-model siblings
      // at the leaf level are re-hydrated by `getBranchMessages(includeSiblings)`,
      // so it doesn't matter which member of a leaf group we pin.
      const [leaf] = await db.all<{ id: string }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
          UNION ALL
          SELECT m.id FROM message m
          INNER JOIN subtree s ON m.parent_id = s.id
          WHERE m.deleted_at IS NULL
        )
        SELECT s.id FROM subtree s
        WHERE NOT EXISTS (
          SELECT 1 FROM message c
          WHERE c.parent_id = s.id AND c.deleted_at IS NULL
        )
        LIMIT 1
      `)
      targetId = leaf?.id ?? nodeId
    }

    await db.update(topicTable).set({ activeNodeId: targetId }).where(eq(topicTable.id, topicId))

    logger.info('Set active node', { topicId, requestedNodeId: nodeId, activeNodeId: targetId, descend })

    return { activeNodeId: targetId }
  }
}

export const topicService = new TopicService()
