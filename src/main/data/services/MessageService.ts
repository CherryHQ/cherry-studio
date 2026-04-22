/**
 * Message Service - handles message CRUD and tree operations
 *
 * Provides business logic for:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD with tree structure maintenance
 * - Cascade delete and reparenting
 */

import { application } from '@application'
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
  MessageData,
  SiblingsGroup,
  TreeNode,
  TreeResponse
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MessageService')

/**
 * Input for `reserveAssistantTurn` — one "chat turn" reservation.
 *
 * Placeholders have `parentId` and `siblingsGroupId` intentionally omitted:
 * both are derived by the reservation (placeholders always hang off the user
 * message, and share the turn's group).
 *
 * An optional `id` on each placeholder lets callers (notably the AI stream
 * pipeline) pre-generate the UUID on the renderer and thread it through so
 * `useChat.activeResponse` and the DB row agree — eliminating the
 * duplicate-assistant-message bug caused by client/DB id divergence.
 */
export interface ReserveAssistantTurnPlaceholder
  extends Omit<CreateMessageDto, 'parentId' | 'siblingsGroupId' | 'setAsActive'> {
  /** Optional caller-supplied UUID; falls back to the schema default when omitted. */
  id?: string
}

export interface ReserveAssistantTurnInput {
  topicId: string
  userMessage: { mode: 'create'; dto: CreateMessageDto } | { mode: 'existing'; id: string }
  /** If set, placeholders use this group and existing children with groupId=0 are backfilled. */
  siblingsGroupId?: number
  placeholders: ReserveAssistantTurnPlaceholder[]
}

export interface ReserveAssistantTurnResult {
  userMessage: Message
  /** In the same order as `input.placeholders`. */
  placeholders: Message[]
}

/**
 * Preview length for tree nodes
 */
const PREVIEW_LENGTH = 50

/**
 * Default pagination limit
 */
const DEFAULT_LIMIT = 20

/**
 * Convert database row to Message entity.
 *
 * Expects camelCase keys — only ORM-channel results match.
 * Raw SQL via `db.all(sql\`...\`)` returns snake_case columns and CANNOT be
 * passed here directly. See docs/references/data/database-patterns.md →
 * "Raw SQL Queries & Recursive CTEs" for the recommended CTE-for-IDs +
 * ORM-for-rows pattern used by getTree, getBranchMessages, getPathToNode.
 *
 * Also handles JSON columns: ORM returns parsed objects; the parseJson
 * helper covers any legacy code path that still hands in JSON strings.
 */
function rowToMessage(row: typeof messageTable.$inferSelect): Message {
  // Handle JSON strings from raw SQL queries (db.all with sql``)
  // ORM queries (.select().from()) return already-parsed objects
  const parseJson = <T>(value: T | string | null | undefined): T | null => {
    if (value == null) return null
    if (typeof value === 'string') return JSON.parse(value)
    return value as T
  }

  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    role: row.role as Message['role'],
    data: parseJson(row.data)!,
    searchableText: row.searchableText,
    status: row.status as Message['status'],
    siblingsGroupId: row.siblingsGroupId ?? 0,
    modelId: (row.modelId ?? null) as UniqueModelId | null,
    modelSnapshot: parseJson(row.modelSnapshot),
    traceId: row.traceId,
    stats: parseJson(row.stats),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
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
    status: message.status,
    createdAt: message.createdAt,
    hasChildren
  }
}

export class MessageService {
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
    const db = application.get('DbService').getDb()
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
        .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
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
          SELECT id, parent_id FROM message WHERE id = ${activeNodeId} AND deleted_at IS NULL
          UNION ALL
          SELECT m.id, m.parent_id FROM message m
          INNER JOIN path p ON m.id = p.parent_id
          WHERE m.deleted_at IS NULL
        )
        SELECT id FROM path
      `)
      pathRows.forEach((r) => activePath.add(r.id))
    }

    // Get tree with depth limit via CTE
    // Use a large depth for unlimited (-1)
    const maxDepth = depth === -1 ? 999 : depth

    // Recursive CTE returns ID + depth only (single-word columns are
    // casing-safe). Full rows are fetched via ORM below for camelCase mapping.
    // See docs/references/data/database-patterns.md.
    const treeDepthRows = await db.all<{ id: string; tree_depth: number }>(sql`
      WITH RECURSIVE tree AS (
        SELECT id, 0 as tree_depth FROM message WHERE id = ${rootId} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id, t.tree_depth + 1 FROM message m
        INNER JOIN tree t ON m.parent_id = t.id
        WHERE t.tree_depth < ${maxDepth} AND m.deleted_at IS NULL
      )
      SELECT id, tree_depth FROM tree
    `)

    const depthByCteId = new Map(treeDepthRows.map((r) => [r.id, r.tree_depth]))
    const baseTreeRows =
      treeDepthRows.length === 0
        ? []
        : await db
            .select()
            .from(messageTable)
            .where(
              inArray(
                messageTable.id,
                treeDepthRows.map((r) => r.id)
              )
            )

    const treeRows: Array<typeof messageTable.$inferSelect & { treeDepth: number }> = baseTreeRows.map((r) => ({
      ...r,
      treeDepth: depthByCteId.get(r.id)!
    }))

    // Also fetch active path nodes that might be beyond depth limit
    const treeNodeIds = new Set(treeRows.map((r) => r.id))
    const missingActivePathIds = [...activePath].filter((id) => !treeNodeIds.has(id))

    if (missingActivePathIds.length > 0) {
      const additionalRows = await db
        .select()
        .from(messageTable)
        .where(and(inArray(messageTable.id, missingActivePathIds), isNull(messageTable.deletedAt)))
      treeRows.push(...additionalRows.map((r) => ({ ...r, treeDepth: maxDepth + 1 })))
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
          treeRows.push({ ...row, treeDepth: maxDepth + 1 })
          treeNodeIds.add(row.id)
        }
      }
    } else if (activePathArray.length > 0) {
      // No tree nodes loaded yet, just get all children of active path
      const childrenRows = await db
        .select()
        .from(messageTable)
        .where(and(inArray(messageTable.parentId, activePathArray), isNull(messageTable.deletedAt)))

      for (const row of childrenRows) {
        if (!treeNodeIds.has(row.id)) {
          treeRows.push({ ...row, treeDepth: maxDepth + 1 })
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
      depthMap.set(message.id, row.treeDepth)

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
   *
   * Uses "before cursor" pagination semantics:
   * - cursor: Message ID marking the pagination boundary (exclusive)
   * - Returns messages BEFORE the cursor (towards root)
   * - The cursor message itself is NOT included
   * - nextCursor points to the oldest message in current batch
   *
   * Example flow:
   * 1. First request (no cursor) → returns msg80-99, nextCursor=msg80.id
   * 2. Second request (cursor=msg80.id) → returns msg60-79, nextCursor=msg60.id
   */
  async getBranchMessages(
    topicId: string,
    options: { nodeId?: string; cursor?: string; limit?: number; includeSiblings?: boolean } = {}
  ): Promise<BranchMessagesResponse> {
    const db = application.get('DbService').getDb()
    const { cursor, limit = DEFAULT_LIMIT, includeSiblings = true } = options

    // Get topic
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    const nodeId = options.nodeId || topic.activeNodeId

    // Return empty if no active node
    if (!nodeId) {
      return { items: [], nextCursor: undefined, activeNodeId: null }
    }

    // Use recursive CTE to collect path IDs from nodeId to root (single-column
    // result is casing-safe), then fetch full rows via ORM to get camelCase
    // mapping. See docs/references/data/database-patterns.md.
    const pathIdRows = await db.all<{ id: string }>(sql`
      WITH RECURSIVE path AS (
        SELECT id, parent_id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id, m.parent_id FROM message m
        INNER JOIN path p ON m.id = p.parent_id
        WHERE m.deleted_at IS NULL
      )
      SELECT id FROM path
    `)

    if (pathIdRows.length === 0) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    const pathIds = pathIdRows.map((r) => r.id)
    const pathRows = await db.select().from(messageTable).where(inArray(messageTable.id, pathIds))

    // Preserve CTE order (nodeId → root); ORM IN-list does not guarantee order.
    const pathOrder = new Map(pathIds.map((id, i) => [id, i]))
    const pathMessages = pathRows.sort((a, b) => pathOrder.get(a.id)! - pathOrder.get(b.id)!)

    // Reverse to get root->nodeId order
    const fullPath = pathMessages.reverse()

    // Apply pagination
    let startIndex = 0
    let endIndex = fullPath.length

    if (cursor) {
      const cursorIndex = fullPath.findIndex((m) => m.id === cursor)
      if (cursorIndex === -1) {
        throw DataApiErrorFactory.notFound('Message (cursor)', cursor)
      }
      startIndex = Math.max(0, cursorIndex - limit)
      endIndex = cursorIndex
    } else {
      startIndex = Math.max(0, fullPath.length - limit)
    }

    const paginatedPath = fullPath.slice(startIndex, endIndex)

    // Calculate nextCursor: if there are more historical messages
    const nextCursor = startIndex > 0 ? fullPath[startIndex].id : undefined

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
          .where(and(isNull(messageTable.deletedAt), or(...orConditions)))

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
      items: result,
      nextCursor,
      activeNodeId: topic.activeNodeId
    }
  }

  /**
   * Get a single message by ID
   */
  async getById(id: string): Promise<Message> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.id, id), isNull(messageTable.deletedAt)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Message', id)
    }

    return rowToMessage(row)
  }

  /** Get all children of a message (messages whose parentId = given id). */
  async getChildrenByParentId(parentId: string): Promise<Message[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.parentId, parentId), isNull(messageTable.deletedAt)))
    return rows.map(rowToMessage)
  }

  /** Update siblingsGroupId for a single message. */
  async updateSiblingsGroupId(id: string, siblingsGroupId: number): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.update(messageTable).set({ siblingsGroupId }).where(eq(messageTable.id, id))
  }

  /**
   * Create a new sibling of an existing message.
   *
   * Used by edit-and-resend flows where the user wants to branch the
   * conversation rather than overwrite the previous turn. Runs in a single
   * transaction so the source's `siblingsGroupId` backfill (when needed) and
   * the new row's insert are atomic.
   *
   * Behavior:
   * - Allocates a new `siblingsGroupId` (`Date.now()`) only if the source is
   *   still ungrouped (`= 0`); otherwise joins the source's existing group.
   * - The new message inherits the source's `role` and `topicId`, hangs off
   *   the same `parentId`, and always becomes the topic's active node.
   *
   * Rejects rooted messages: a root has no parent, so "sibling under the
   * same parent" isn't expressible.
   */
  async createSibling(sourceId: string, data: MessageData): Promise<Message> {
    const db = application.get('DbService').getDb()

    return await db.transaction(async (tx) => {
      const [source] = await tx.select().from(messageTable).where(eq(messageTable.id, sourceId)).limit(1)
      if (!source) {
        throw DataApiErrorFactory.notFound('Message', sourceId)
      }
      if (source.parentId === null) {
        throw DataApiErrorFactory.invalidOperation('create sibling', 'root message has no siblings')
      }

      let siblingsGroupId = source.siblingsGroupId ?? 0
      if (siblingsGroupId === 0) {
        siblingsGroupId = Date.now()
        await tx.update(messageTable).set({ siblingsGroupId }).where(eq(messageTable.id, sourceId))
      }

      const [row] = await tx
        .insert(messageTable)
        .values({
          topicId: source.topicId,
          parentId: source.parentId,
          role: source.role,
          data,
          status: 'pending',
          siblingsGroupId
        })
        .returning()

      await tx.update(topicTable).set({ activeNodeId: row.id }).where(eq(topicTable.id, source.topicId))

      logger.info('Created sibling message', {
        sourceId,
        newId: row.id,
        parentId: source.parentId,
        siblingsGroupId
      })

      return rowToMessage(row)
    })
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
    const db = application.get('DbService').getDb()

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
          modelId: dto.modelId ?? null,
          modelSnapshot: dto.modelSnapshot,
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
   * Atomically reserve an assistant turn: insert (or resolve) one user message,
   * optionally backfill existing siblings with groupId=0, and insert N assistant
   * placeholders as children, then point topic.activeNodeId at the last placeholder.
   *
   * The whole operation runs in a single DB transaction, so a failure anywhere
   * rolls back everything — callers don't need compensation logic. Designed for
   * the AI Stream reservation phase where multi-model / regenerate turns must be
   * written as one unit to avoid orphaned user messages or pending placeholders.
   *
   * User message handling:
   * - `mode: 'create'`: caller supplies a CreateMessageDto; parentId must be null
   *   (for root) or an existing message id in this topic. Auto-resolve is not
   *   supported here — this API is for chat reservation, not general inserts.
   * - `mode: 'existing'`: caller supplies the id of an already-persisted user
   *   message (regenerate scenario).
   *
   * Siblings backfill: if `siblingsGroupId` is provided, any existing children
   * of the user message whose `siblingsGroupId = 0` are backfilled to it. This
   * is a no-op when there are no existing children (fresh turn) or when they
   * already belong to a group (inherit case).
   */
  async reserveAssistantTurn(input: ReserveAssistantTurnInput): Promise<ReserveAssistantTurnResult> {
    const db = application.get('DbService').getDb()

    return await db.transaction(async (tx) => {
      // Validate topic
      const [topic] = await tx.select().from(topicTable).where(eq(topicTable.id, input.topicId)).limit(1)
      if (!topic) {
        throw DataApiErrorFactory.notFound('Topic', input.topicId)
      }

      // 1. Resolve user message — insert new, or fetch existing
      let userMessage: Message
      if (input.userMessage.mode === 'create') {
        const dto = input.userMessage.dto
        let resolvedParentId: string | null

        if (dto.parentId === undefined || dto.parentId === null) {
          // Explicit/default root: enforce single-root invariant
          const [existingRoot] = await tx
            .select({ id: messageTable.id })
            .from(messageTable)
            .where(and(eq(messageTable.topicId, input.topicId), isNull(messageTable.parentId)))
            .limit(1)
          if (existingRoot) {
            throw DataApiErrorFactory.invalidOperation('create root message', 'Topic already has a root message')
          }
          resolvedParentId = null
        } else {
          const [parent] = await tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)
          if (!parent) {
            throw DataApiErrorFactory.notFound('Message', dto.parentId)
          }
          if (parent.topicId !== input.topicId) {
            throw DataApiErrorFactory.invalidOperation('create message', 'Parent message does not belong to this topic')
          }
          resolvedParentId = dto.parentId
        }

        const [row] = await tx
          .insert(messageTable)
          .values({
            topicId: input.topicId,
            parentId: resolvedParentId,
            role: dto.role,
            data: dto.data,
            status: dto.status ?? 'pending',
            siblingsGroupId: dto.siblingsGroupId ?? 0,
            modelId: dto.modelId,
            modelSnapshot: dto.modelSnapshot,
            traceId: dto.traceId,
            stats: dto.stats
          })
          .returning()
        userMessage = rowToMessage(row)
      } else {
        const [row] = await tx.select().from(messageTable).where(eq(messageTable.id, input.userMessage.id)).limit(1)
        if (!row) {
          throw DataApiErrorFactory.notFound('Message', input.userMessage.id)
        }
        if (row.topicId !== input.topicId) {
          throw DataApiErrorFactory.invalidOperation(
            'reserve assistant turn',
            'User message does not belong to this topic'
          )
        }
        userMessage = rowToMessage(row)
      }

      // 2. Backfill siblings with groupId=0 under the user message
      if (input.siblingsGroupId != null) {
        await tx
          .update(messageTable)
          .set({ siblingsGroupId: input.siblingsGroupId })
          .where(and(eq(messageTable.parentId, userMessage.id), eq(messageTable.siblingsGroupId, 0)))
      }

      // 3. Insert placeholders (preserving input order)
      const placeholders: Message[] = []
      for (const p of input.placeholders) {
        const [row] = await tx
          .insert(messageTable)
          .values({
            ...(p.id && { id: p.id }),
            topicId: input.topicId,
            parentId: userMessage.id,
            role: p.role,
            data: p.data,
            status: p.status ?? 'pending',
            siblingsGroupId: input.siblingsGroupId ?? 0,
            modelId: p.modelId,
            modelSnapshot: p.modelSnapshot,
            traceId: p.traceId,
            stats: p.stats
          })
          .returning()
        placeholders.push(rowToMessage(row))
      }

      // 4. Point activeNodeId at the last placeholder (or user message if N=0)
      const newActiveNodeId = placeholders.at(-1)?.id ?? userMessage.id
      await tx.update(topicTable).set({ activeNodeId: newActiveNodeId }).where(eq(topicTable.id, input.topicId))

      logger.info('Reserved assistant turn', {
        topicId: input.topicId,
        userMessageId: userMessage.id,
        placeholderIds: placeholders.map((p) => p.id),
        siblingsGroupId: input.siblingsGroupId
      })

      return { userMessage, placeholders }
    })
  }

  /**
   * Update a message
   *
   * Uses transaction to ensure atomicity of validation and update.
   * Cycle check is performed outside transaction as a read-only safety check.
   */
  async update(id: string, dto: UpdateMessageDto): Promise<Message> {
    const db = application.get('DbService').getDb()

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
    const db = application.get('DbService').getDb()

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
    const db = application.get('DbService').getDb()

    // Use recursive query to get all descendants
    const result = await db.all<{ id: string }>(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM message WHERE parent_id = ${id} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id FROM message m
        INNER JOIN descendants d ON m.parent_id = d.id
        WHERE m.deleted_at IS NULL
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
    const db = application.get('DbService').getDb()

    // Recursive CTE collects ancestor IDs (single-column, casing-safe);
    // full rows fetched via ORM for camelCase mapping.
    const ancestorIdRows = await db.all<{ id: string }>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id, m.parent_id FROM message m
        INNER JOIN ancestors a ON m.id = a.parent_id
        WHERE m.deleted_at IS NULL
      )
      SELECT id FROM ancestors
    `)

    if (ancestorIdRows.length === 0) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    const ancestorIds = ancestorIdRows.map((r) => r.id)
    const ancestorRows = await db.select().from(messageTable).where(inArray(messageTable.id, ancestorIds))

    // Preserve CTE order (nodeId → root) before reversing to root → nodeId.
    const ancestorOrder = new Map(ancestorIds.map((id, i) => [id, i]))
    const ordered = ancestorRows.sort((a, b) => ancestorOrder.get(a.id)! - ancestorOrder.get(b.id)!)

    return ordered.reverse().map(rowToMessage)
  }
}

export const messageService = new MessageService()
