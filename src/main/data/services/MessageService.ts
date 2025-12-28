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
import type { CreateMessageDto, UpdateMessageDto } from '@shared/data/api/schemas/messages'
import type {
  BranchMessage,
  BranchMessagesResponse,
  Message,
  SiblingsGroup,
  TreeNode,
  TreeResponse
} from '@shared/data/types/message'
import { eq, inArray, sql } from 'drizzle-orm'

const logger = loggerService.withContext('MessageService')

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

    // Get all messages for this topic
    const allMessages = await db.select().from(messageTable).where(eq(messageTable.topicId, topicId))

    if (allMessages.length === 0) {
      return { nodes: [], siblingsGroups: [], activeNodeId: null }
    }

    const messagesById = new Map<string, Message>()
    const childrenMap = new Map<string, string[]>()

    for (const row of allMessages) {
      const message = rowToMessage(row)
      messagesById.set(message.id, message)

      const parentId = message.parentId || 'root'
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, [])
      }
      childrenMap.get(parentId)!.push(message.id)
    }

    // Find root node(s) and build active path
    const rootIds = childrenMap.get('root') || []
    const rootId = options.rootId || rootIds[0]

    // Build path from rootId to activeNodeId
    const activePath = new Set<string>()
    if (activeNodeId) {
      let currentId: string | null = activeNodeId
      while (currentId) {
        activePath.add(currentId)
        const message = messagesById.get(currentId)
        currentId = message?.parentId || null
      }
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
            .filter((m) => m.siblingsGroupId === message.siblingsGroupId)

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
    if (rootId) {
      collectNodes(rootId, 0, activePath.has(rootId))
    }

    return {
      nodes: resultNodes,
      siblingsGroups,
      activeNodeId
    }
  }

  /**
   * Get branch messages for conversation view
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

    // Get all messages for this topic
    const allMessages = await db.select().from(messageTable).where(eq(messageTable.topicId, topicId))

    if (allMessages.length === 0) {
      return { messages: [], activeNodeId: null }
    }

    // Check for data inconsistency
    if (!topic.activeNodeId) {
      throw DataApiErrorFactory.dataInconsistent('Topic', 'has messages but no active node')
    }

    const nodeId = options.nodeId || topic.activeNodeId
    const messagesById = new Map<string, Message>()

    for (const row of allMessages) {
      messagesById.set(row.id, rowToMessage(row))
    }

    // Build path from root to nodeId
    const path: string[] = []
    let currentId: string | null = nodeId
    while (currentId) {
      path.unshift(currentId)
      const message = messagesById.get(currentId)
      if (!message) {
        throw DataApiErrorFactory.notFound('Message', currentId)
      }
      currentId = message.parentId
    }

    // Apply pagination
    let startIndex = 0
    if (options.beforeNodeId) {
      const beforeIndex = path.indexOf(options.beforeNodeId)
      if (beforeIndex === -1) {
        throw DataApiErrorFactory.notFound('Message', options.beforeNodeId)
      }
      startIndex = Math.max(0, beforeIndex - limit)
    } else {
      startIndex = Math.max(0, path.length - limit)
    }

    const endIndex = options.beforeNodeId ? path.indexOf(options.beforeNodeId) : path.length

    const resultPath = path.slice(startIndex, endIndex)

    // Build result with optional siblings
    const result: BranchMessage[] = []

    for (const msgId of resultPath) {
      const message = messagesById.get(msgId)!

      let siblingsGroup: Message[] | undefined
      if (includeSiblings && message.siblingsGroupId !== 0) {
        // Find siblings with same parentId and siblingsGroupId
        siblingsGroup = allMessages
          .filter(
            (row) =>
              row.parentId === message.parentId &&
              row.siblingsGroupId === message.siblingsGroupId &&
              row.id !== message.id
          )
          .map(rowToMessage)
      }

      result.push({
        message,
        siblingsGroup
      })
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
   */
  async create(topicId: string, dto: CreateMessageDto): Promise<Message> {
    const db = dbService.getDb()

    // Verify topic exists
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    // Verify parent exists if specified
    if (dto.parentId) {
      const [parent] = await db.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)

      if (!parent) {
        throw DataApiErrorFactory.notFound('Message', dto.parentId)
      }
    }

    const [row] = await db
      .insert(messageTable)
      .values({
        topicId,
        parentId: dto.parentId,
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
      await db.update(topicTable).set({ activeNodeId: row.id }).where(eq(topicTable.id, topicId))
    }

    logger.info('Created message', { id: row.id, topicId, role: dto.role, setAsActive: dto.setAsActive !== false })

    return rowToMessage(row)
  }

  /**
   * Update a message
   */
  async update(id: string, dto: UpdateMessageDto): Promise<Message> {
    const db = dbService.getDb()

    // Get existing message
    const existing = await this.getById(id)

    // Check for cycle if moving to new parent
    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      if (dto.parentId !== null) {
        // Check that new parent is not a descendant
        const descendants = await this.getDescendantIds(id)
        if (descendants.includes(dto.parentId)) {
          throw DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
        }

        // Verify new parent exists
        const [parent] = await db.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)

        if (!parent) {
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
      }
    }

    // Build update object
    const updates: Partial<typeof messageTable.$inferInsert> = {}

    if (dto.data !== undefined) updates.data = dto.data
    if (dto.parentId !== undefined) updates.parentId = dto.parentId
    if (dto.siblingsGroupId !== undefined) updates.siblingsGroupId = dto.siblingsGroupId
    if (dto.status !== undefined) updates.status = dto.status

    const [row] = await db.update(messageTable).set(updates).where(eq(messageTable.id, id)).returning()

    logger.info('Updated message', { id, changes: Object.keys(dto) })

    return rowToMessage(row)
  }

  /**
   * Delete a message (hard delete)
   */
  async delete(id: string, cascade: boolean = false): Promise<{ deletedIds: string[]; reparentedIds?: string[] }> {
    const db = dbService.getDb()

    // Get the message
    const message = await this.getById(id)

    // Check if it's a root message
    const isRoot = message.parentId === null

    if (isRoot && !cascade) {
      throw DataApiErrorFactory.invalidOperation('delete root message', 'cascade=true required')
    }

    if (cascade) {
      // Get all descendants
      const descendantIds = await this.getDescendantIds(id)
      const allIds = [id, ...descendantIds]

      // Hard delete all
      await db.delete(messageTable).where(inArray(messageTable.id, allIds))

      logger.info('Cascade deleted messages', { rootId: id, count: allIds.length })

      return { deletedIds: allIds }
    } else {
      // Reparent children to this message's parent
      const children = await db.select({ id: messageTable.id }).from(messageTable).where(eq(messageTable.parentId, id))

      const childIds = children.map((c) => c.id)

      if (childIds.length > 0) {
        await db.update(messageTable).set({ parentId: message.parentId }).where(inArray(messageTable.id, childIds))
      }

      // Hard delete this message
      await db.delete(messageTable).where(eq(messageTable.id, id))

      logger.info('Deleted message with reparenting', { id, reparentedCount: childIds.length })

      return { deletedIds: [id], reparentedIds: childIds }
    }
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
   */
  async getPathToNode(nodeId: string): Promise<Message[]> {
    const path: Message[] = []
    let currentId: string | null = nodeId

    while (currentId) {
      const message = await this.getById(currentId)
      path.unshift(message)
      currentId = message.parentId
    }

    return path
  }
}

export const messageService = MessageService.getInstance()
