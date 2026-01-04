/**
 * Message Service - handles message CRUD and tree operations
 *
 * Provides business logic for:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD with tree structure maintenance
 * - Cascade delete and reparenting
 */

import { dbService } from '@data/db/DbService'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  ActiveNodeStrategy,
  CreateMessageDto,
  DeleteMessageResponse,
  UpdateMessageDto
} from '@shared/data/api/schemas/messages'
import type {
  BranchMessage,
  BranchMessagesResponse,
  Message,
  SiblingsGroup,
  TreeNode,
  TreeResponse
} from '@shared/data/types/message'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:MessageService')

/**
 * Preview length for tree nodes
 */
const PREVIEW_LENGTH = 50

/**
 * Default pagination limit
 */
const DEFAULT_LIMIT = 20

/**
 * Convert database row to Message entity
 */
function rowToMessage(row: typeof messageTable.$inferSelect): Message {
  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    role: row.role as Message['role'],
    data: row.data,
    searchableText: row.searchableText,
    status: row.status as Message['status'],
    siblingsGroupId: row.siblingsGroupId ?? 0,
    assistantId: row.assistantId,
    assistantMeta: row.assistantMeta,
    modelId: row.modelId,
    modelMeta: row.modelMeta,
    traceId: row.traceId,
    stats: row.stats,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

/**
 * Extract preview text from message data
 */
function extractPreview(message: Message): string {
  const blocks = message.data?.blocks || []
  for (const block of blocks) {
    if ('content' in block && typeof block.content === 'string') {
      const text = block.content.trim()
      if (text.length > 0) {
        return text.length > PREVIEW_LENGTH ? text.substring(0, PREVIEW_LENGTH) + '...' : text
      }
    }
  }
  return ''
}

/**
 * Convert Message to TreeNode
 */
function messageToTreeNode(message: Message, hasChildren: boolean): TreeNode {
  return {
    id: message.id,
    parentId: message.parentId,
    role: message.role === 'system' ? 'assistant' : message.role,
    preview: extractPreview(message),
    modelId: message.modelId,
    modelMeta: message.modelMeta,
    status: message.status,
    createdAt: message.createdAt,
    hasChildren
  }
}

export class MessageService {
  private static instance: MessageService

  private constructor() {}

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService()
    }
    return MessageService.instance
  }

  /**
   * Get tree structure for visualization
   *
   * Optimized to avoid loading all messages:
   * 1. Uses CTE to get active path (single query)
   * 2. Uses CTE to get tree nodes within depth limit (single query)
   * 3. Fetches additional nodes for active path if beyond depth limit
   */
  async getTree(
    topicId: string,
    options: { rootId?: string; nodeId?: string; depth?: number } = {}
  ): Promise<TreeResponse> {
    const db = dbService.getDb()
    const { depth = 1 } = options

    // Get topic to verify existence and get activeNodeId
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    const activeNodeId = options.nodeId || topic.activeNodeId

    // Find root node if not specified
    let rootId = options.rootId
    if (!rootId) {
      const [root] = await db
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(and(eq(messageTable.topicId, topicId), sql`${messageTable.parentId} IS NULL`))
        .limit(1)
      rootId = root?.id
    }

    if (!rootId) {
      return { nodes: [], siblingsGroups: [], activeNodeId: null }
    }

    // Build active path via CTE (single query)
    const activePath = new Set<string>()
    if (activeNodeId) {
      const pathRows = await db.all<{ id: string }>(sql`
        WITH RECURSIVE path AS (
          SELECT id, parent_id FROM message WHERE id = ${activeNodeId}
          UNION ALL
          SELECT m.id, m.parent_id FROM message m
          INNER JOIN path p ON m.id = p.parent_id
        )
        SELECT id FROM path
      `)
      pathRows.forEach((r) => activePath.add(r.id))
    }

    // Get tree with depth limit via CTE
    // Use a large depth for unlimited (-1)
    const maxDepth = depth === -1 ? 999 : depth

    const treeRows = await db.all<typeof messageTable.$inferSelect & { tree_depth: number }>(sql`
      WITH RECURSIVE tree AS (
        SELECT *, 0 as tree_depth FROM message WHERE id = ${rootId}
        UNION ALL
        SELECT m.*, t.tree_depth + 1 FROM message m
        INNER JOIN tree t ON m.parent_id = t.id
        WHERE t.tree_depth < ${maxDepth}
      )
      SELECT * FROM tree
    `)

    // Also fetch active path nodes that might be beyond depth limit
    const treeNodeIds = new Set(treeRows.map((r) => r.id))
    const missingActivePathIds = [...activePath].filter((id) => !treeNodeIds.has(id))

    if (missingActivePathIds.length > 0) {
      const additionalRows = await db.select().from(messageTable).where(inArray(messageTable.id, missingActivePathIds))
      treeRows.push(...additionalRows.map((r) => ({ ...r, tree_depth: maxDepth + 1 })))
    }

    // Also need children of active path nodes for proper tree building
    // Get all children of active path nodes that we haven't loaded yet
    const activePathArray = [...activePath]
    if (activePathArray.length > 0 && treeNodeIds.size > 0) {
      const childrenRows = await db
        .select()
        .from(messageTable)
        .where(
          and(
            inArray(messageTable.parentId, activePathArray),
            sql`${messageTable.id} NOT IN (${sql.join(
              [...treeNodeIds].map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        )

      for (const row of childrenRows) {
        if (!treeNodeIds.has(row.id)) {
          treeRows.push({ ...row, tree_depth: maxDepth + 1 })
          treeNodeIds.add(row.id)
        }
      }
    } else if (activePathArray.length > 0) {
      // No tree nodes loaded yet, just get all children of active path
      const childrenRows = await db.select().from(messageTable).where(inArray(messageTable.parentId, activePathArray))

      for (const row of childrenRows) {
        if (!treeNodeIds.has(row.id)) {
          treeRows.push({ ...row, tree_depth: maxDepth + 1 })
          treeNodeIds.add(row.id)
        }
      }
    }

    if (treeRows.length === 0) {
      return { nodes: [], siblingsGroups: [], activeNodeId: null }
    }

    // Build maps for tree processing
    const messagesById = new Map<string, Message>()
    const childrenMap = new Map<string, string[]>()
    const depthMap = new Map<string, number>()

    for (const row of treeRows) {
      const message = rowToMessage(row)
      messagesById.set(message.id, message)
      depthMap.set(message.id, row.tree_depth)

      const parentId = message.parentId || 'root'
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, [])
      }
      childrenMap.get(parentId)!.push(message.id)
    }

    // Collect nodes based on depth
    const resultNodes: TreeNode[] = []
    const siblingsGroups: SiblingsGroup[] = []
    const visitedGroups = new Set<string>()

    const collectNodes = (nodeId: string, currentDepth: number, isOnActivePath: boolean) => {
      const message = messagesById.get(nodeId)
      if (!message) return

      const children = childrenMap.get(nodeId) || []
      const hasChildren = children.length > 0

      // Check if this message is part of a siblings group
      if (message.siblingsGroupId !== 0) {
        const groupKey = `${message.parentId}-${message.siblingsGroupId}`
        if (!visitedGroups.has(groupKey)) {
          visitedGroups.add(groupKey)

          // Find all siblings in this group
          const parentChildren = childrenMap.get(message.parentId || 'root') || []
          const groupMembers = parentChildren
            .map((id) => messagesById.get(id)!)
            .filter((m) => m && m.siblingsGroupId === message.siblingsGroupId)

          if (groupMembers.length > 1) {
            siblingsGroups.push({
              parentId: message.parentId!,
              siblingsGroupId: message.siblingsGroupId,
              nodes: groupMembers.map((m) => {
                const memberChildren = childrenMap.get(m.id) || []
                const node = messageToTreeNode(m, memberChildren.length > 0)
                const { parentId: _parentId, ...rest } = node
                void _parentId // Intentionally unused - removing parentId from TreeNode for SiblingsGroup
                return rest
              })
            })
          } else {
            // Single member, add as regular node
            resultNodes.push(messageToTreeNode(message, hasChildren))
          }
        }
      } else {
        resultNodes.push(messageToTreeNode(message, hasChildren))
      }

      // Recurse to children
      const shouldExpand = isOnActivePath || (depth === -1 ? true : currentDepth < depth)
      if (shouldExpand) {
        for (const childId of children) {
          const childOnPath = activePath.has(childId)
          collectNodes(childId, isOnActivePath ? 0 : currentDepth + 1, childOnPath)
        }
      }
    }

    // Start from root
    collectNodes(rootId, 0, activePath.has(rootId))

    return {
      nodes: resultNodes,
      siblingsGroups,
      activeNodeId
    }
  }

  /**
   * Get branch messages for conversation view
   *
   * Optimized implementation using recursive CTE to fetch only the path
   * from nodeId to root, avoiding loading all messages for large topics.
   * Siblings are batch-queried in a single additional query.
   */
  async getBranchMessages(
    topicId: string,
    options: { nodeId?: string; beforeNodeId?: string; limit?: number; includeSiblings?: boolean } = {}
  ): Promise<BranchMessagesResponse> {
    const db = dbService.getDb()
    const { limit = DEFAULT_LIMIT, includeSiblings = true } = options

    // Get topic
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    const nodeId = options.nodeId || topic.activeNodeId

    // Return empty if no active node
    if (!nodeId) {
      return { messages: [], activeNodeId: null }
    }

    // Use recursive CTE to get path from nodeId to root (single query)
    const pathMessages = await db.all<typeof messageTable.$inferSelect>(sql`
      WITH RECURSIVE path AS (
        SELECT * FROM message WHERE id = ${nodeId}
        UNION ALL
        SELECT m.* FROM message m
        INNER JOIN path p ON m.id = p.parent_id
      )
      SELECT * FROM path
    `)

    if (pathMessages.length === 0) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    // Reverse to get root->nodeId order
    const fullPath = pathMessages.reverse()

    // Apply pagination
    let startIndex = 0
    let endIndex = fullPath.length

    if (options.beforeNodeId) {
      const beforeIndex = fullPath.findIndex((m) => m.id === options.beforeNodeId)
      if (beforeIndex === -1) {
        throw DataApiErrorFactory.notFound('Message', options.beforeNodeId)
      }
      startIndex = Math.max(0, beforeIndex - limit)
      endIndex = beforeIndex
    } else {
      startIndex = Math.max(0, fullPath.length - limit)
    }

    const paginatedPath = fullPath.slice(startIndex, endIndex)

    // Build result with optional siblings
    const result: BranchMessage[] = []

    if (includeSiblings) {
      // Collect unique (parentId, siblingsGroupId) pairs that need siblings
      const uniqueGroups = new Set<string>()
      const groupsToQuery: Array<{ parentId: string; siblingsGroupId: number }> = []

      for (const msg of paginatedPath) {
        if (msg.siblingsGroupId && msg.siblingsGroupId !== 0 && msg.parentId) {
          const key = `${msg.parentId}-${msg.siblingsGroupId}`
          if (!uniqueGroups.has(key)) {
            uniqueGroups.add(key)
            groupsToQuery.push({ parentId: msg.parentId, siblingsGroupId: msg.siblingsGroupId })
          }
        }
      }

      // Batch query all siblings if needed
      const siblingsMap = new Map<string, Message[]>()

      if (groupsToQuery.length > 0) {
        // Build OR conditions for batch query
        const orConditions = groupsToQuery.map((g) =>
          and(eq(messageTable.parentId, g.parentId), eq(messageTable.siblingsGroupId, g.siblingsGroupId))
        )

        const siblingsRows = await db
          .select()
          .from(messageTable)
          .where(or(...orConditions))

        // Group results by parentId-siblingsGroupId
        for (const row of siblingsRows) {
          const key = `${row.parentId}-${row.siblingsGroupId}`
          if (!siblingsMap.has(key)) siblingsMap.set(key, [])
          siblingsMap.get(key)!.push(rowToMessage(row))
        }
      }

      // Build result with siblings from map
      for (const msg of paginatedPath) {
        const message = rowToMessage(msg)
        let siblingsGroup: Message[] | undefined

        if (msg.siblingsGroupId !== 0 && msg.parentId) {
          const key = `${msg.parentId}-${msg.siblingsGroupId}`
          const group = siblingsMap.get(key)
          if (group && group.length > 1) {
            siblingsGroup = group.filter((m) => m.id !== message.id)
          }
        }

        result.push({ message, siblingsGroup })
      }
    } else {
      // No siblings needed, just map messages
      for (const msg of paginatedPath) {
        result.push({ message: rowToMessage(msg) })
      }
    }

    return {
      messages: result,
      activeNodeId: topic.activeNodeId
    }
  }

  /**
   * Get a single message by ID
   */
  async getById(id: string): Promise<Message> {
    const db = dbService.getDb()

    const [row] = await db.select().from(messageTable).where(eq(messageTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Message', id)
    }

    return rowToMessage(row)
  }

  /**
   * Create a new message
   *
   * Uses transaction to ensure atomicity of:
   * - Topic existence validation
   * - Parent message validation (if specified)
   * - Message insertion
   * - Topic activeNodeId update
   */
  async create(topicId: string, dto: CreateMessageDto): Promise<Message> {
    const db = dbService.getDb()

    return await db.transaction(async (tx) => {
      // Step 1: Verify topic exists and fetch its current state.
      // We need the topic to check activeNodeId for parentId auto-resolution.
      const [topic] = await tx.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

      if (!topic) {
        throw DataApiErrorFactory.notFound('Topic', topicId)
      }

      // Step 2: Resolve parentId based on the three possible input states:
      // - undefined: auto-resolve based on topic state
      // - null: explicitly create as root (must validate uniqueness)
      // - string: use provided ID (must validate existence and ownership)
      let resolvedParentId: string | null

      if (dto.parentId === undefined) {
        // Auto-resolution mode: Determine parentId based on topic's current state.
        // This provides convenience for callers who want to "append" to the conversation
        // without needing to know the tree structure.

        // Check if topic has any existing messages by querying for at least one.
        const [existingMessage] = await tx
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(eq(messageTable.topicId, topicId))
          .limit(1)

        if (!existingMessage) {
          // Topic is empty: This will be the first message, so it becomes the root.
          // Root messages have parentId = null.
          resolvedParentId = null
        } else if (topic.activeNodeId) {
          // Topic has messages and an active node: Attach new message as child of activeNodeId.
          // This is the typical case for continuing a conversation.
          resolvedParentId = topic.activeNodeId
        } else {
          // Topic has messages but no activeNodeId: This is an ambiguous state.
          // We cannot auto-resolve because we don't know where in the tree to attach.
          // Require explicit parentId from caller to resolve the ambiguity.
          throw DataApiErrorFactory.invalidOperation(
            'create message',
            'Topic has messages but no activeNodeId. Please specify parentId explicitly.'
          )
        }
      } else if (dto.parentId === null) {
        // Explicit root creation: Caller wants to create a root message.
        // Each topic can only have one root message (parentId = null).
        // Check if a root already exists to enforce this constraint.

        const [existingRoot] = await tx
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId)))
          .limit(1)

        if (existingRoot) {
          // Root already exists: Cannot create another root message.
          // This enforces the single-root tree structure constraint.
          throw DataApiErrorFactory.invalidOperation('create root message', 'Topic already has a root message')
        }
        resolvedParentId = null
      } else {
        // Explicit parent ID provided: Validate the parent exists and belongs to this topic.
        // This ensures referential integrity within the message tree.

        const [parent] = await tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)

        if (!parent) {
          // Parent message not found: Cannot attach to non-existent message.
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
        if (parent.topicId !== topicId) {
          // Parent belongs to different topic: Cross-topic references are not allowed.
          // Each topic's message tree must be self-contained.
          throw DataApiErrorFactory.invalidOperation('create message', 'Parent message does not belong to this topic')
        }
        resolvedParentId = dto.parentId
      }

      // Step 3: Insert the message using the resolved parentId.
      const [row] = await tx
        .insert(messageTable)
        .values({
          topicId,
          parentId: resolvedParentId,
          role: dto.role,
          data: dto.data,
          status: dto.status ?? 'pending',
          siblingsGroupId: dto.siblingsGroupId ?? 0,
          assistantId: dto.assistantId,
          assistantMeta: dto.assistantMeta,
          modelId: dto.modelId,
          modelMeta: dto.modelMeta,
          traceId: dto.traceId,
          stats: dto.stats
        })
        .returning()

      // Update activeNodeId if setAsActive is not explicitly false
      if (dto.setAsActive !== false) {
        await tx.update(topicTable).set({ activeNodeId: row.id }).where(eq(topicTable.id, topicId))
      }

      logger.info('Created message', { id: row.id, topicId, role: dto.role, setAsActive: dto.setAsActive !== false })

      return rowToMessage(row)
    })
  }

  /**
   * Update a message
   *
   * Uses transaction to ensure atomicity of validation and update.
   * Cycle check is performed outside transaction as a read-only safety check.
   */
  async update(id: string, dto: UpdateMessageDto): Promise<Message> {
    const db = dbService.getDb()

    // Pre-transaction: Check for cycle if moving to new parent
    // This is done outside transaction since getDescendantIds uses its own db context
    // and cycle check is a safety check (worst case: reject valid operation)
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const descendants = await this.getDescendantIds(id)
      if (descendants.includes(dto.parentId)) {
        throw DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
      }
    }

    return await db.transaction(async (tx) => {
      // Get existing message within transaction
      const [existingRow] = await tx.select().from(messageTable).where(eq(messageTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('Message', id)
      }

      const existing = rowToMessage(existingRow)

      // Verify new parent exists if changing parent
      if (dto.parentId !== undefined && dto.parentId !== existing.parentId && dto.parentId !== null) {
        const [parent] = await tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)

        if (!parent) {
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
      }

      // Build update object
      const updates: Partial<typeof messageTable.$inferInsert> = {}

      if (dto.data !== undefined) updates.data = dto.data
      if (dto.parentId !== undefined) updates.parentId = dto.parentId
      if (dto.siblingsGroupId !== undefined) updates.siblingsGroupId = dto.siblingsGroupId
      if (dto.status !== undefined) updates.status = dto.status
      if (dto.traceId !== undefined) updates.traceId = dto.traceId
      if (dto.stats !== undefined) updates.stats = dto.stats

      const [row] = await tx.update(messageTable).set(updates).where(eq(messageTable.id, id)).returning()

      logger.info('Updated message', { id, changes: Object.keys(dto) })

      return rowToMessage(row)
    })
  }

  /**
   * Delete a message (hard delete)
   *
   * Supports two modes:
   * - cascade=true: Delete the message and all its descendants
   * - cascade=false: Delete only this message, reparent children to grandparent
   *
   * When the deleted message(s) include the topic's activeNodeId, it will be
   * automatically updated based on activeNodeStrategy:
   * - 'parent' (default): Sets activeNodeId to the deleted message's parent
   * - 'clear': Sets activeNodeId to null
   *
   * All operations are performed within a transaction for consistency.
   *
   * @param id - Message ID to delete
   * @param cascade - If true, delete descendants; if false, reparent children (default: false)
   * @param activeNodeStrategy - Strategy for updating activeNodeId if affected (default: 'parent')
   * @returns Deletion result including deletedIds, reparentedIds, and newActiveNodeId
   * @throws NOT_FOUND if message doesn't exist
   * @throws INVALID_OPERATION if deleting root without cascade=true
   */
  async delete(
    id: string,
    cascade: boolean = false,
    activeNodeStrategy: ActiveNodeStrategy = 'parent'
  ): Promise<DeleteMessageResponse> {
    const db = dbService.getDb()

    // Get the message
    const message = await this.getById(id)

    // Get topic to check activeNodeId
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, message.topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', message.topicId)
    }

    // Check if it's a root message
    const isRoot = message.parentId === null

    if (isRoot && !cascade) {
      throw DataApiErrorFactory.invalidOperation('delete root message', 'cascade=true required')
    }

    // Get all descendant IDs before transaction (for cascade delete)
    let descendantIds: string[] = []
    if (cascade) {
      descendantIds = await this.getDescendantIds(id)
    }

    // Use transaction for atomic delete + activeNodeId update
    return await db.transaction(async (tx) => {
      let deletedIds: string[]
      let reparentedIds: string[] | undefined
      let newActiveNodeId: string | null | undefined

      if (cascade) {
        deletedIds = [id, ...descendantIds]

        // Check if activeNodeId is affected
        if (topic.activeNodeId && deletedIds.includes(topic.activeNodeId)) {
          newActiveNodeId = activeNodeStrategy === 'clear' ? null : message.parentId
        }

        // Hard delete all
        await tx.delete(messageTable).where(inArray(messageTable.id, deletedIds))

        logger.info('Cascade deleted messages', { rootId: id, count: deletedIds.length })
      } else {
        // Reparent children to this message's parent
        const children = await tx
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(eq(messageTable.parentId, id))

        reparentedIds = children.map((c) => c.id)

        if (reparentedIds.length > 0) {
          await tx
            .update(messageTable)
            .set({ parentId: message.parentId })
            .where(inArray(messageTable.id, reparentedIds))
        }

        deletedIds = [id]

        // Check if activeNodeId is affected
        if (topic.activeNodeId === id) {
          newActiveNodeId = activeNodeStrategy === 'clear' ? null : message.parentId
        }

        // Hard delete this message
        await tx.delete(messageTable).where(eq(messageTable.id, id))

        logger.info('Deleted message with reparenting', { id, reparentedCount: reparentedIds.length })
      }

      // Update topic.activeNodeId if needed
      if (newActiveNodeId !== undefined) {
        await tx.update(topicTable).set({ activeNodeId: newActiveNodeId }).where(eq(topicTable.id, message.topicId))

        logger.info('Updated topic activeNodeId after message deletion', {
          topicId: message.topicId,
          oldActiveNodeId: topic.activeNodeId,
          newActiveNodeId
        })
      }

      return {
        deletedIds,
        reparentedIds: reparentedIds?.length ? reparentedIds : undefined,
        newActiveNodeId
      }
    })
  }

  /**
   * Get all descendant IDs of a message
   */
  private async getDescendantIds(id: string): Promise<string[]> {
    const db = dbService.getDb()

    // Use recursive query to get all descendants
    const result = await db.all<{ id: string }>(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM message WHERE parent_id = ${id}
        UNION ALL
        SELECT m.id FROM message m
        INNER JOIN descendants d ON m.parent_id = d.id
      )
      SELECT id FROM descendants
    `)

    return result.map((r) => r.id)
  }

  /**
   * Get path from root to a node
   *
   * Uses recursive CTE to fetch all ancestors in a single query,
   * avoiding N+1 query problem for deep message trees.
   */
  async getPathToNode(nodeId: string): Promise<Message[]> {
    const db = dbService.getDb()

    // Use recursive CTE to get all ancestors in one query
    const result = await db.all<typeof messageTable.$inferSelect>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT * FROM message WHERE id = ${nodeId}
        UNION ALL
        SELECT m.* FROM message m
        INNER JOIN ancestors a ON m.id = a.parent_id
      )
      SELECT * FROM ancestors
    `)

    if (result.length === 0) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    // Result is from nodeId to root, reverse to get root to nodeId
    return result.reverse().map(rowToMessage)
  }
}

export const messageService = MessageService.getInstance()
