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
      // Ownership transfer before cascade: forks and their source topic are
      // peers, not parent-child, so deleting one must not collapse the
      // others. For every other live topic with an `activeNodeId`, walk
      // that topic's ancestor chain and reassign any encountered messages
      // whose `topic_id` is the one being deleted — those ancestors are
      // still needed by at least one survivor.
      //
      // First-come-first-served ordering is deterministic via
      // `ORDER BY created_at`: the oldest survivor inherits first, and
      // once a message's `topic_id` is no longer `:id`, subsequent
      // dependents' UPDATE simply won't match it. The final `DELETE FROM
      // message WHERE topic_id = :id` sweep then removes only the
      // messages that were exclusive to the deleted topic.
      const otherTopics = await tx.all<{ id: string; activeNodeId: string }>(sql`
        SELECT id, active_node_id as activeNodeId
        FROM topic
        WHERE id != ${id}
          AND deleted_at IS NULL
          AND active_node_id IS NOT NULL
        ORDER BY created_at
      `)

      for (const survivor of otherTopics) {
        await tx.run(sql`
          WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM message
            WHERE id = ${survivor.activeNodeId} AND deleted_at IS NULL
            UNION ALL
            SELECT m.id, m.parent_id FROM message m
            INNER JOIN ancestors a ON m.id = a.parent_id
            WHERE m.deleted_at IS NULL
          )
          UPDATE message
          SET topic_id = ${survivor.id}
          WHERE id IN (SELECT id FROM ancestors)
            AND topic_id = ${id}
        `)
      }

      // Hard delete remaining (exclusively-owned) messages + tags + topic row.
      await tx.delete(messageTable).where(eq(messageTable.topicId, id))
      await tagService.purgeForEntity(tx, 'topic', id)
      await tx.delete(topicTable).where(eq(topicTable.id, id))
    })

    logger.info('Deleted topic', { id })
  }

  /**
   * Set the active node for a topic.
   *
   * The caller supplies a branch entry point (e.g. a user-message sibling from
   * the navigator). `getBranchMessages` walks ancestors, so pointing
   * `activeNodeId` at a non-leaf would truncate the rendered conversation at
   * that node and hide its descendants (the follow-up assistant turns on that
   * branch). To preserve the conversation view we descend to the leaf of the
   * target branch first — at each step picking the most recently created child
   * so multi-model groups resolve to their latest member and newly-forked
   * branches to the freshest turn.
   */
  async setActiveNode(topicId: string, nodeId: string): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(topicId)

    // Verify node exists. Cross-topic refs are valid: a forked topic's
    // `activeNodeId` legitimately points into the source topic's shared
    // ancestor chain, so we must not reject by `message.topicId !== topicId`.
    const [message] = await db.select().from(messageTable).where(eq(messageTable.id, nodeId)).limit(1)

    if (!message) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    // Descend to any leaf in the subtree rooted at `nodeId`. Picking an
    // arbitrary leaf is sufficient: `getBranchMessages(includeSiblings: true)`
    // re-hydrates the whole sibling group for each path node, so multi-model
    // alternatives at the leaf level render together regardless of which
    // member is `activeNodeId`.
    const [leaf] = await db.all<{ id: string }>(sql`
      WITH RECURSIVE descend AS (
        SELECT id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id FROM message m
        INNER JOIN descend d ON m.parent_id = d.id
        WHERE m.deleted_at IS NULL
      )
      SELECT d.id FROM descend d
      WHERE NOT EXISTS (
        SELECT 1 FROM message c
        WHERE c.parent_id = d.id AND c.deleted_at IS NULL
      )
      LIMIT 1
    `)
    const leafId = leaf?.id ?? nodeId

    await db.update(topicTable).set({ activeNodeId: leafId }).where(eq(topicTable.id, topicId))

    logger.info('Set active node', { topicId, requestedNodeId: nodeId, resolvedLeafId: leafId })

    return { activeNodeId: leafId }
  }
}

export const topicService = new TopicService()
