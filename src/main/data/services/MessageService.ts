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
import { type MessageRow, messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { applyApprovalDecisions, type ApprovalDecision } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  ActiveNodeStrategy,
  CreateMessageDto,
  DeleteMessageResponse,
  UpdateMessageDto
} from '@shared/data/api/schemas/messages'
import type { TopicMessageContentSearchItem } from '@shared/data/api/schemas/search'
import {
  type BranchMessage,
  type BranchMessagesResponse,
  type CherryMessagePart,
  coerceSearchRole,
  type Message,
  type MessageData,
  type SiblingsGroup,
  toContentRole,
  TOPIC_MESSAGE_SEARCH_ROLES,
  type TreeNode,
  type TreeResponse
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { buildSearchSnippet } from '@shared/utils/searchSnippet'
import { isToolUIPart } from 'ai'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { getDataService, registerDataService } from './dataServiceRegistry'
import { type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MessageService')

/**
 * Input for `createUserMessageWithPlaceholders` — one chat turn (user
 * message + assistant placeholder rows).
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
export interface AssistantPlaceholder extends Omit<CreateMessageDto, 'parentId' | 'siblingsGroupId' | 'setAsActive'> {
  /** Optional caller-supplied UUID; falls back to the schema default when omitted. */
  id?: string
}

export interface CreateUserMessageWithPlaceholdersInput {
  topicId: string
  userMessage: { mode: 'create'; dto: CreateMessageDto } | { mode: 'existing'; id: string }
  /** If set, placeholders use this group and existing children with groupId=0 are backfilled. */
  siblingsGroupId?: number
  placeholders: AssistantPlaceholder[]
}

export interface CreateUserMessageWithPlaceholdersResult {
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
const MESSAGE_SEARCH_CURSOR_CONFIG = {
  fieldMessage: 'must be a valid search cursor',
  errorMessage: 'Invalid message search cursor'
}

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
function rowToMessage(row: MessageRow): Message {
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
    siblingsGroupId: row.siblingsGroupId,
    modelId: (row.modelId ?? null) as UniqueModelId | null,
    modelSnapshot: parseJson(row.modelSnapshot),
    stats: parseJson(row.stats),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/**
 * Extract preview text from message data
 */
function truncatePreview(text: string): string {
  return text.length > PREVIEW_LENGTH ? text.substring(0, PREVIEW_LENGTH) + '...' : text
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined

  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function getObjectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : undefined
}

function extractPreview(message: Message): string {
  const parts = message.data?.parts || []
  for (const part of parts) {
    const data = getObjectField(part, 'data')
    const text =
      part.type === 'text'
        ? getStringField(part, 'text')
        : ['data-code', 'data-translation'].includes(part.type)
          ? getStringField(data, 'content')
          : part.type === 'data-compact'
            ? (getStringField(data, 'content') ?? getStringField(data, 'compactedContent'))
            : part.type === 'data-error'
              ? getStringField(data, 'message')
              : undefined

    const preview = text?.trim()
    if (preview) {
      return truncatePreview(preview)
    }
  }

  return ''
}

/**
 * Convert Message to TreeNode
 */
function messageToTreeNode(message: Message, hasChildren: boolean): TreeNode {
  if (message.parentId === null) {
    // The virtual root is the only parentId-null row and is never a tree node — tree
    // queries descend from its children — so a content tree node always has a parent.
    // The guard narrows `parentId` to a non-null `string` without an assertion; it never fires.
    throw new Error(`messageToTreeNode: message ${message.id} has no parent`)
  }
  return {
    id: message.id,
    parentId: message.parentId,
    // Tree nodes carry content roles only; toContentRole narrows (the root never reaches
    // here — guarded above) and 'system' is surfaced as 'assistant' for display.
    role: message.role === 'system' ? 'assistant' : toContentRole(message.role),
    preview: extractPreview(message),
    modelId: message.modelId,
    status: message.status,
    createdAt: message.createdAt,
    hasChildren
  }
}

type MessageSearchRow = {
  id: string
  topicId: string
  topicName: string
  topicAssistantId: string | null
  role: string
  topicCreatedAt: number
  topicUpdatedAt: number
  searchableText: string
  createdAt: number
}

type MessageContentSearchInput = {
  q: string
  cursor?: string
  limit?: number
  createdAtFrom?: string
  topicId?: string
}

export class MessageService {
  async purgeByTopicIdsTx(tx: Pick<DbType, 'delete'>, topicIds: string[]): Promise<void> {
    const uniqueTopicIds = Array.from(new Set(topicIds))
    if (uniqueTopicIds.length === 0) return

    await tx.delete(messageTable).where(inArray(messageTable.topicId, uniqueTopicIds))
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
    const db = application.get('DbService').getDb()
    const { depth = 1 } = options

    // Get topic to verify existence and get activeNodeId
    const [topic] = await db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1)

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    const activeNodeId = options.nodeId || topic.activeNodeId

    // Build active path via CTE (single query)
    const activePath = new Set<string>()
    if (activeNodeId) {
      const pathRows = await db.all<{ id: string; parent_id: string | null }>(sql`
        WITH RECURSIVE path AS (
          SELECT id, parent_id FROM message WHERE id = ${activeNodeId} AND deleted_at IS NULL
          UNION ALL
          SELECT m.id, m.parent_id FROM message m
          INNER JOIN path p ON m.id = p.parent_id
          WHERE m.deleted_at IS NULL
        )
        SELECT id, parent_id FROM path
      `)
      pathRows.forEach((r) => {
        activePath.add(r.id)
      })
    }

    // The virtual root (the single parentId-null row) is structural and never
    // rendered. Drop it from the active path; its children — the first-turn
    // messages — are the logical roots of the flow canvas.
    const [rootRow] = await db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
    const virtualRootId = rootRow?.id ?? null
    if (virtualRootId) {
      activePath.delete(virtualRootId)
    }

    // Without an explicit root, the flow canvas is a topic-level view: every
    // first-turn message (child of the virtual root) starts its own tree.
    const explicitRootId = options.rootId
    // The virtual root is never a renderable tree node; using it as an explicit root
    // would feed it to messageToTreeNode (which throws on a parentless node).
    if (explicitRootId && explicitRootId === virtualRootId) {
      throw DataApiErrorFactory.invalidOperation('get tree', 'rootId cannot be the virtual root')
    }
    const rootIds = explicitRootId
      ? [explicitRootId]
      : virtualRootId
        ? (
            await db
              .select({ id: messageTable.id, createdAt: messageTable.createdAt })
              .from(messageTable)
              .where(
                and(
                  eq(messageTable.topicId, topicId),
                  eq(messageTable.parentId, virtualRootId),
                  isNull(messageTable.deletedAt)
                )
              )
          )
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
            .map((row) => row.id)
        : []

    if (rootIds.length === 0) {
      return { nodes: [], siblingsGroups: [], activeNodeId: null, rootId: virtualRootId }
    }

    // Get tree with depth limit via CTE
    // Use a large depth for unlimited (-1)
    const maxDepth = depth === -1 ? 999 : depth

    // Recursive CTE returns ID + depth only (single-word columns are
    // casing-safe). Full rows are fetched via ORM below for camelCase mapping.
    // See docs/references/data/database-patterns.md.
    const treeDepthRows = await db.all<{ id: string; tree_depth: number }>(sql`
      WITH RECURSIVE tree AS (
        SELECT id, 0 as tree_depth FROM message
        WHERE id IN (${sql.join(
          rootIds.map((id) => sql`${id}`),
          sql`, `
        )}) AND deleted_at IS NULL
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
      for (const row of additionalRows) {
        treeRows.push({ ...row, treeDepth: maxDepth + 1 })
        treeNodeIds.add(row.id)
      }
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
            isNull(messageTable.deletedAt),
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
      return { nodes: [], siblingsGroups: [], activeNodeId: null, rootId: virtualRootId }
    }

    // Build maps for tree processing
    const messagesById = new Map<string, Message>()
    const childrenMap = new Map<string, string[]>()
    const depthMap = new Map<string, number>()

    for (const row of treeRows) {
      const message = rowToMessage(row)
      // First-turn messages keep their real parent — the topic's virtual root. The
      // virtual root itself is never a tree node (rootIds are its children), so no
      // tree node / sibling group has a null parent; the canvas skips edges to the
      // (unrendered) virtual root.
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
    const childrenKeyFor = (parentId: string | null) => parentId ?? 'root'
    const groupKeyFor = (parentId: string | null, siblingsGroupId: number) => `${parentId ?? 'root'}-${siblingsGroupId}`

    const collectNodes = (nodeId: string, currentDepth: number, isOnActivePath: boolean) => {
      const message = messagesById.get(nodeId)
      if (!message) return

      const children = childrenMap.get(nodeId) || []
      const hasChildren = children.length > 0

      // Check if this message is part of a siblings group
      const siblingsGroupId = message.siblingsGroupId ?? 0
      // A grouped message always has a non-null parent (the virtual root for first-turn
      // groups, else a content message); the parentId-null virtual root is never grouped.
      // The `parentId !== null` guard narrows it without a non-null assertion.
      if (siblingsGroupId !== 0 && message.parentId !== null) {
        const groupParentId = message.parentId
        const groupKey = groupKeyFor(groupParentId, siblingsGroupId)
        if (!visitedGroups.has(groupKey)) {
          visitedGroups.add(groupKey)

          // Find all siblings in this group
          const parentChildren = childrenMap.get(childrenKeyFor(groupParentId)) || []
          const groupMembers = parentChildren
            .map((id) => messagesById.get(id)!)
            .filter((m) => m && m.siblingsGroupId === siblingsGroupId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

          if (groupMembers.length > 1) {
            siblingsGroups.push({
              parentId: groupParentId,
              siblingsGroupId,
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

    // Start from the logical roots — the virtual root's children (first-turn messages).
    // Each is an independent subtree the flow canvas collects.
    for (const startRootId of rootIds) {
      collectNodes(startRootId, 0, activePath.has(startRootId))
    }

    return {
      nodes: resultNodes,
      siblingsGroups,
      activeNodeId,
      rootId: virtualRootId
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

    // Authoritative first-turn signal for renderers (pagination-independent): a message is a
    // first turn iff its parentId === this root id. Looked up once, returned in the response.
    const [rootRow] = await db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
    const rootId = rootRow?.id ?? null

    const nodeId = options.nodeId || topic.activeNodeId

    // Return empty if no active node
    if (!nodeId) {
      return { items: [], nextCursor: undefined, activeNodeId: null, assistantId: topic.assistantId, rootId }
    }

    const fullPath = await this.getPathRowsToNodeTx(db, nodeId, { topicId })

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
      // Collect unique (parentId, siblingsGroupId) pairs that need siblings.
      const uniqueGroups = new Set<string>()
      const groupsToQuery: Array<{ parentId: string | null; siblingsGroupId: number }> = []
      const groupKeyFor = (parentId: string | null, siblingsGroupId: number) =>
        `${parentId ?? 'root'}-${siblingsGroupId}`

      for (const msg of paginatedPath) {
        if (msg.siblingsGroupId && msg.siblingsGroupId !== 0) {
          const key = groupKeyFor(msg.parentId, msg.siblingsGroupId)
          if (!uniqueGroups.has(key)) {
            uniqueGroups.add(key)
            groupsToQuery.push({ parentId: msg.parentId, siblingsGroupId: msg.siblingsGroupId })
          }
        }
      }

      // Batch query all siblings if needed
      const siblingsMap = new Map<string, Message[]>()

      if (groupsToQuery.length > 0) {
        const orConditions = groupsToQuery.map((g) =>
          and(
            eq(messageTable.topicId, topicId),
            g.parentId === null ? isNull(messageTable.parentId) : eq(messageTable.parentId, g.parentId),
            eq(messageTable.siblingsGroupId, g.siblingsGroupId)
          )
        )

        const siblingsRows = await db
          .select()
          .from(messageTable)
          .where(and(isNull(messageTable.deletedAt), or(...orConditions)))

        for (const row of siblingsRows) {
          const key = groupKeyFor(row.parentId, row.siblingsGroupId ?? 0)
          if (!siblingsMap.has(key)) siblingsMap.set(key, [])
          siblingsMap.get(key)!.push(rowToMessage(row))
        }
      }

      // Build result with siblings from map
      for (const msg of paginatedPath) {
        const message = rowToMessage(msg)
        let siblingsGroup: Message[] | undefined

        if (msg.siblingsGroupId != null && msg.siblingsGroupId !== 0) {
          const key = groupKeyFor(msg.parentId, msg.siblingsGroupId)
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
      activeNodeId: topic.activeNodeId,
      assistantId: topic.assistantId,
      rootId
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

  /**
   * Ids of assistant rows still in `pending` — used by the boot reconcile of crash-orphaned turns.
   * Selects only `id` (reconcile just flips them to `error`); backed by `message_status_idx`.
   */
  async findPendingAssistantMessageIds(): Promise<string[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(
        and(eq(messageTable.role, 'assistant'), eq(messageTable.status, 'pending'), isNull(messageTable.deletedAt))
      )
    return rows.map((row) => row.id)
  }

  /**
   * Flip the given rows to `error` in a single serialized write. Paired with
   * {@link findPendingAssistantMessages} for the boot reconcile of crash-orphaned `pending`
   * turns. Routes through `withWriteTx` so it serializes with any other write path active
   * during the WhenReady boot phase.
   */
  async markMessagesError(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx.update(messageTable).set({ status: 'error' }).where(inArray(messageTable.id, ids))
    })
  }

  async search(query: MessageContentSearchInput) {
    const db = application.get('DbService').getDb()
    const topicConditionForMessageAlias = query.topicId ? sql`message.topic_id = ${query.topicId}` : sql`1 = 1`

    return await searchWithCursor<MessageSearchRow, TopicMessageContentSearchItem>({
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      createdAtFrom: query.createdAtFrom,
      cursorConfig: MESSAGE_SEARCH_CURSOR_CONFIG,
      fetchRows: async ({ ftsConditions, cursor, createdAtFromMs, offset, chunkSize }: SearchFetchContext) => {
        const createdAtConditionForMessageAlias =
          createdAtFromMs !== undefined ? sql`message.created_at >= ${createdAtFromMs}` : sql`1 = 1`

        return await db.all<MessageSearchRow>(sql`
          SELECT
            message.id,
            message.topic_id AS "topicId",
            t.name AS "topicName",
            t.assistant_id AS "topicAssistantId",
            message.role,
            t.created_at AS "topicCreatedAt",
            t.updated_at AS "topicUpdatedAt",
            message.searchable_text AS "searchableText",
            message.created_at AS "createdAt"
          FROM message
          JOIN message_fts fts ON message.rowid = fts.rowid
          JOIN topic t ON t.id = message.topic_id
          WHERE message.deleted_at IS NULL
            AND t.deleted_at IS NULL
            AND message.searchable_text != ''
            AND ${topicConditionForMessageAlias}
            AND ${createdAtConditionForMessageAlias}
            AND ${sql.join(ftsConditions, sql` AND `)}
            AND ${
              cursor
                ? sql`(message.created_at < ${cursor.createdAt} OR (message.created_at = ${cursor.createdAt} AND message.id < ${cursor.id}))`
                : sql`1 = 1`
            }
          ORDER BY message.created_at DESC, message.id DESC
          LIMIT ${chunkSize}
          OFFSET ${offset}
        `)
      },
      getSearchableText: (row) => row.searchableText,
      buildSnippet: buildSearchSnippet,
      mapRow: (row, { snippet }) => ({
        item: {
          messageId: row.id,
          topicId: row.topicId,
          topicName: row.topicName,
          topicAssistantId: row.topicAssistantId ?? undefined,
          role: coerceSearchRole(row.role, TOPIC_MESSAGE_SEARCH_ROLES),
          topicCreatedAt: timestampToISO(Number(row.topicCreatedAt)),
          topicUpdatedAt: timestampToISO(Number(row.topicUpdatedAt)),
          snippet,
          createdAt: timestampToISO(Number(row.createdAt))
        },
        sort: {
          createdAt: Number(row.createdAt),
          id: row.id
        }
      })
    })
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
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx.update(messageTable).set({ siblingsGroupId }).where(eq(messageTable.id, id))
    })
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
   * - Edited user siblings are already complete (`success`); assistant siblings
   *   stay `pending` until their response stream resolves.
   * - First-turn messages hang off the topic's virtual root, so editing / resending
   *   the first user turn creates an ordinary sibling under that root — no special case.
   */
  async createSibling(sourceId: string, data: MessageData): Promise<Message> {
    return await application.get('DbService').withWriteTx(async (tx) => {
      const [source] = await tx.select().from(messageTable).where(eq(messageTable.id, sourceId)).limit(1)
      if (!source) {
        throw DataApiErrorFactory.notFound('Message', sourceId)
      }
      // The virtual root has no siblings — copying its null parentId would insert a second
      // null-parent row and trip message_topic_root_uniq. Reject cleanly (the CHECK +
      // unique index are the structural backstop; this is the friendly API error).
      if (source.role === 'root' || source.parentId === null) {
        throw DataApiErrorFactory.invalidOperation(
          'create sibling of the virtual root',
          'the virtual root has no siblings'
        )
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
          status: source.role === 'user' ? 'success' : 'pending',
          siblingsGroupId
        })
        .returning()

      const topicService = getDataService('TopicService')
      await topicService.setActiveNodeTx(tx, source.topicId, row.id, { assumeValid: true })

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
   * Insert the topic's virtual root — the single `parentId = null` row: content-less
   * (`role = 'root'`, empty `data`), never rendered. The dedicated `role = 'root'`
   * makes the row self-identifying, so role-filtered content queries (`role = 'system'`
   * etc.) exclude it for free. Every real message hangs below it, so first-turn messages
   * and their resends are ordinary siblings under a shared parent — no multi-root. Called
   * exactly once per topic by every topic-creation path (create / duplicate / temp-chat
   * persist / v1→v2 migrator); the `message_topic_root_uniq` index enforces single-root.
   * `role = 'root'` and `parentId IS NULL` are equivalent, with this method (and the
   * migrator) as the sole writers of both.
   */
  async createRootMessageTx(tx: DbOrTx, topicId: string): Promise<string> {
    const [row] = await tx
      .insert(messageTable)
      .values({ topicId, parentId: null, role: 'root', data: { parts: [] }, status: 'success', siblingsGroupId: 0 })
      .returning({ id: messageTable.id })
    return row.id
  }

  /**
   * Return the topic's virtual-root message id. Every topic has exactly one, created
   * eagerly at topic creation, so message-creation paths just read it. Throws if absent
   * — a missing root means a topic-creation path failed to call {@link createRootMessageTx}.
   */
  async getRootMessageIdTx(tx: DbOrTx, topicId: string): Promise<string> {
    const [row] = await tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
    if (!row) {
      throw DataApiErrorFactory.invalidOperation('resolve root message', `Topic ${topicId} has no virtual root`)
    }
    return row.id
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
    return await application.get('DbService').withWriteTx(async (tx) => {
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
        // Auto-resolve: `activeNodeId` is the authoritative "where we are" marker —
        // append there. An empty topic (no active node) starts its first turn under
        // the virtual root.
        resolvedParentId = topic.activeNodeId ?? (await this.getRootMessageIdTx(tx, topicId))
      } else if (dto.parentId === null) {
        // First-turn message: hang it off the topic's virtual root (created if absent).
        // First turns and their resends are ordinary siblings under this shared root.
        resolvedParentId = await this.getRootMessageIdTx(tx, topicId)
      } else {
        // Explicit parent ID: verify existence and topic membership. Each
        // topic's message tree is self-contained — cross-topic parent refs
        // aren't a supported shape.
        const [parent] = await tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1)

        if (!parent) {
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
        if (parent.topicId !== topicId) {
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
          siblingsGroupId: dto.siblingsGroupId,
          modelId: dto.modelId ?? null,
          modelSnapshot: dto.modelSnapshot,
          stats: dto.stats
        })
        .returning()

      // Update activeNodeId if setAsActive is not explicitly false
      if (dto.setAsActive !== false) {
        const topicService = getDataService('TopicService')
        await topicService.setActiveNodeTx(tx, topicId, row.id, { assumeValid: true })
      }

      logger.info('Created message', { id: row.id, topicId, role: dto.role, setAsActive: dto.setAsActive !== false })

      return rowToMessage(row)
    })
  }

  /**
   * Atomically create one chat turn: insert (or resolve) one user message,
   * optionally backfill existing siblings with groupId=0, and insert N assistant
   * placeholders as children, then point topic.activeNodeId at the last placeholder.
   *
   * The whole operation runs in a single DB transaction, so a failure anywhere
   * rolls back everything — callers don't need compensation logic. Designed for
   * the AI Stream setup phase where multi-model / regenerate turns must be
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
  async createUserMessageWithPlaceholders(
    input: CreateUserMessageWithPlaceholdersInput
  ): Promise<CreateUserMessageWithPlaceholdersResult> {
    return await application.get('DbService').withWriteTx(async (tx) => {
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
          // First-turn message: hang it off the topic's virtual root (created if absent).
          resolvedParentId = await this.getRootMessageIdTx(tx, input.topicId)
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
            ...(dto.siblingsGroupId !== undefined ? { siblingsGroupId: dto.siblingsGroupId } : {}),
            modelId: dto.modelId,
            modelSnapshot: dto.modelSnapshot,
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
            ...(input.siblingsGroupId !== undefined ? { siblingsGroupId: input.siblingsGroupId } : {}),
            modelId: p.modelId,
            modelSnapshot: p.modelSnapshot,
            stats: p.stats
          })
          .returning()
        placeholders.push(rowToMessage(row))
      }

      // 4. Point activeNodeId at the last placeholder (or user message if N=0)
      const newActiveNodeId = placeholders.at(-1)?.id ?? userMessage.id
      const topicService = getDataService('TopicService')
      await topicService.setActiveNodeTx(tx, input.topicId, newActiveNodeId, { assumeValid: true })

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
    // Pre-transaction: Check for cycle if moving to new parent
    // This is done outside transaction since getDescendantIds uses its own db context
    // and cycle check is a safety check (worst case: reject valid operation)
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const descendants = await this.getDescendantIds(id)
      if (descendants.includes(dto.parentId)) {
        throw DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
      }
    }

    return await application.get('DbService').withWriteTx(async (tx) => {
      // Get existing message within transaction
      const [existingRow] = await tx.select().from(messageTable).where(eq(messageTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('Message', id)
      }

      const existing = rowToMessage(existingRow)

      // Single-root guards (mirror createSibling/delete; the CHECK + unique index are the
      // structural backstop, these give clean errors):
      // - the virtual root cannot be reparented (it would lose its null parent → topic
      //   left rootless);
      // - a content message cannot be moved to parentId=null (it would become a second
      //   null-parent row → unique-index violation).
      if (dto.parentId !== undefined) {
        if (existing.role === 'root') {
          throw DataApiErrorFactory.invalidOperation('move message', 'the virtual root cannot be reparented')
        }
        if (dto.parentId === null) {
          throw DataApiErrorFactory.invalidOperation(
            'move message',
            'a message cannot be reparented to the virtual root slot'
          )
        }
      }

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
      if (dto.stats !== undefined) updates.stats = dto.stats

      const [row] = await tx.update(messageTable).set(updates).where(eq(messageTable.id, id)).returning()

      logger.info('Updated message', { id, changes: Object.keys(dto) })

      return rowToMessage(row)
    })
  }

  /**
   * Atomically apply tool-approval decisions to an anchor message's `parts` within a single write
   * transaction. A multi-tool turn can request several approvals on one assistant row at once;
   * without serialization two concurrent responses read the same stale parts, each writes the whole
   * array back (the later write erasing the earlier decision), and each computes "still pending" from
   * its own stale copy — so a decision is lost and the turn can wait forever. Reading + applying +
   * writing inside one `withWriteTx` serializes them, and the returned committed parts let the caller
   * compute the pending check from authoritative post-commit state.
   *
   * Returns the committed parts + per-decision disposition, or `null` when the anchor row no longer
   * exists (stale click on a deleted message). When no decision targets a present
   * `approval-requested` part (overlay-only — the part isn't persisted yet) the row is left untouched
   * and the still-overlay parts are returned; the caller carries the decision to the continuation,
   * which applies it authoritatively. A decision that targets an already-settled part is reported so
   * stale duplicate clicks don't dispatch another continuation.
   */
  async applyToolApprovalDecisions(
    anchorId: string,
    decisions: ApprovalDecision[]
  ): Promise<{
    parts: CherryMessagePart[]
    appliedApprovalIds: string[]
    alreadySettledApprovalIds: string[]
  } | null> {
    return await application.get('DbService').withWriteTx(async (tx) => {
      const [row] = await tx.select().from(messageTable).where(eq(messageTable.id, anchorId)).limit(1)
      if (!row) return null

      const existing = rowToMessage(row)
      const parts = existing.data.parts ?? []
      const after = applyApprovalDecisions(parts, decisions)
      const requestedIds = new Set(
        parts
          .filter((p) => isToolUIPart(p) && p.state === 'approval-requested')
          .map((p) => (p as { approval?: { id?: string } }).approval?.id)
          .filter((id): id is string => typeof id === 'string')
      )
      const settledIds = new Set(
        parts
          .filter((p) => isToolUIPart(p) && p.state !== 'approval-requested')
          .map((p) => (p as { approval?: { id?: string } }).approval?.id)
          .filter((id): id is string => typeof id === 'string')
      )
      const appliedApprovalIds = decisions.map((d) => d.approvalId).filter((id) => requestedIds.has(id))
      const alreadySettledApprovalIds = decisions.map((d) => d.approvalId).filter((id) => settledIds.has(id))
      const targetPresent = appliedApprovalIds.length > 0
      if (targetPresent) {
        await tx
          .update(messageTable)
          .set({ data: { ...existing.data, parts: after } })
          .where(eq(messageTable.id, anchorId))
      }
      return { parts: after, appliedApprovalIds, alreadySettledApprovalIds }
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
   * @throws INVALID_OPERATION if the target is the topic's virtual root (removable only
   *   via topic deletion; clear-all deletes the root's children instead)
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

    // The virtual root is structural — deleting it would orphan first-turn children
    // (unique-index violation) or leave a rootless topic (getRootMessageIdTx then throws
    // on the next create). It is removable only via topic deletion (FK cascade). "Clear
    // all messages" must delete the root's *children*, not the root. Reject it regardless
    // of cascade. (role = 'root' and parentId IS NULL are equivalent; either identifies it.)
    if (message.role === 'root' || message.parentId === null) {
      throw DataApiErrorFactory.invalidOperation('delete root message', 'the virtual root cannot be deleted')
    }

    // Get all descendant IDs before transaction (for cascade delete)
    let descendantIds: string[] = []
    if (cascade) {
      descendantIds = await this.getDescendantIds(id)
    }

    // Use transaction for atomic delete + activeNodeId update
    return await application.get('DbService').withWriteTx(async (tx) => {
      let deletedIds: string[]
      let reparentedIds: string[] | undefined
      let newActiveNodeId: string | null | undefined

      // The 'parent' fallback for activeNodeId is the deleted message's parent — but the
      // virtual root is never a valid active node. Deleting a first-turn message (whose
      // parent is the root) must clear activeNodeId, not point it at the root. The parent
      // is always an ancestor (never in deletedIds), so it survives the delete below.
      let parentFallback: string | null = message.parentId
      let parentIsRoot = false
      if (parentFallback) {
        const [parent] = await tx
          .select({ role: messageTable.role })
          .from(messageTable)
          .where(eq(messageTable.id, parentFallback))
          .limit(1)
        parentIsRoot = parent?.role === 'root'
        if (!parent || parentIsRoot) parentFallback = null
      }

      if (cascade) {
        deletedIds = [id, ...descendantIds]

        // Check if activeNodeId is affected
        if (topic.activeNodeId && deletedIds.includes(topic.activeNodeId)) {
          newActiveNodeId = activeNodeStrategy === 'clear' ? null : parentFallback
        }

        // The self-FK is ON DELETE CASCADE, so deleting the target removes its whole
        // subtree in one statement — no leaf-first ordering needed, and no SET NULL to
        // manufacture a colliding parentId-NULL row. (deletedIds above is still derived
        // from getDescendantIds for the response and the activeNodeId check.)
        await tx.delete(messageTable).where(eq(messageTable.id, id))

        logger.info('Cascade deleted messages', { rootId: id, count: deletedIds.length })
      } else {
        // Splice this node out: reparent its children onto its parent (their grandparent).
        // siblingsGroupId is relative to the parent, so a moved child's group id could
        // collide with an unrelated group already under the destination parent and be
        // mis-rendered as the same multi-response set. Rebase each distinct non-zero moved
        // group to a fresh id above any group already present at the destination; group 0
        // (no group) carries over unchanged.
        const children = await tx
          .select({ id: messageTable.id, siblingsGroupId: messageTable.siblingsGroupId })
          .from(messageTable)
          .where(and(eq(messageTable.parentId, id), isNull(messageTable.deletedAt)))

        reparentedIds = children.map((c) => c.id)

        if (reparentedIds.length > 0) {
          const newParentId = message.parentId
          const destRows = newParentId
            ? await tx
                .select({ g: messageTable.siblingsGroupId })
                .from(messageTable)
                .where(and(eq(messageTable.parentId, newParentId), isNull(messageTable.deletedAt)))
            : []
          let nextGroupId = Math.max(0, ...destRows.map((r) => r.g), ...children.map((c) => c.siblingsGroupId)) + 1
          const remap = new Map<number, number>()
          for (const c of children) {
            if (c.siblingsGroupId !== 0 && !remap.has(c.siblingsGroupId)) {
              remap.set(c.siblingsGroupId, nextGroupId++)
            }
          }
          for (const c of children) {
            await tx
              .update(messageTable)
              .set({
                parentId: newParentId,
                siblingsGroupId: c.siblingsGroupId === 0 ? 0 : remap.get(c.siblingsGroupId)!
              })
              .where(eq(messageTable.id, c.id))
          }
        }

        deletedIds = [id]

        // Check if activeNodeId is affected
        if (topic.activeNodeId === id) {
          newActiveNodeId = activeNodeStrategy === 'clear' ? null : parentFallback
        }

        // Hard delete this message
        await tx.delete(messageTable).where(eq(messageTable.id, id))

        logger.info('Deleted message with reparenting', { id, reparentedCount: reparentedIds.length })
      }

      // Update topic.activeNodeId if needed
      if (newActiveNodeId !== undefined) {
        const topicService = getDataService('TopicService')
        if (newActiveNodeId === null) {
          await topicService.clearActiveNodeTx(tx, message.topicId)
        } else {
          await topicService.setActiveNodeTx(tx, message.topicId, newActiveNodeId, { assumeValid: true })
        }

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
   * Clear all of a topic's content messages, keeping the content-less virtual root.
   *
   * The structural replacement for the old "delete the root row to clear the topic":
   * with the virtual root, first turns (and their resends) are independent children of
   * the root and `delete(root)` is rejected, so there is no single message whose cascade
   * clears the topic. This deletes every non-root row of the topic in one transaction —
   * the self-FK `ON DELETE CASCADE` removes whole subtrees, the root (excluded) survives,
   * so the single-root invariant holds — and clears `activeNodeId`.
   */
  async clearTopicMessages(topicId: string): Promise<{ deletedIds: string[] }> {
    return await application.get('DbService').withWriteTx(async (tx) => {
      const rootId = await this.getRootMessageIdTx(tx, topicId)

      const rows = await tx
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(and(eq(messageTable.topicId, topicId), ne(messageTable.id, rootId), isNull(messageTable.deletedAt)))
      const deletedIds = rows.map((r) => r.id)

      if (deletedIds.length === 0) return { deletedIds }

      await tx.delete(messageTable).where(and(eq(messageTable.topicId, topicId), ne(messageTable.id, rootId)))
      await getDataService('TopicService').clearActiveNodeTx(tx, topicId)

      logger.info('Cleared topic messages', { topicId, count: deletedIds.length })
      return { deletedIds }
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
    const pathRows = await this.getPathRowsToNodeTx(db, nodeId)
    return pathRows.map(rowToMessage)
  }

  /**
   * Transaction-aware root -> node path helper. When `topicId` is provided, the
   * full ancestor walk is scoped to that topic so copy/navigation callers keep
   * the same-topic message-tree invariant.
   */
  async getPathRowsToNodeTx(tx: DbOrTx, nodeId: string, options: { topicId?: string } = {}): Promise<MessageRow[]> {
    // Recursive CTE collects ancestor IDs (single-column, casing-safe);
    // full rows fetched via ORM for camelCase mapping.
    const ancestorIdRows = options.topicId
      ? await tx.all<{ id: string }>(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM message
            WHERE id = ${nodeId} AND topic_id = ${options.topicId} AND deleted_at IS NULL
            UNION ALL
            SELECT m.id, m.parent_id FROM message m
            INNER JOIN ancestors a ON m.id = a.parent_id
            WHERE m.topic_id = ${options.topicId} AND m.deleted_at IS NULL
          )
          SELECT id FROM ancestors
        `)
      : await tx.all<{ id: string }>(sql`
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
    const whereClause = options.topicId
      ? and(inArray(messageTable.id, ancestorIds), eq(messageTable.topicId, options.topicId))
      : inArray(messageTable.id, ancestorIds)
    const ancestorRows = await tx.select().from(messageTable).where(whereClause)

    // Preserve CTE order (nodeId → root) before reversing to root → nodeId.
    const ancestorOrder = new Map(ancestorIds.map((id, i) => [id, i]))
    const ordered = ancestorRows.sort((a, b) => ancestorOrder.get(a.id)! - ancestorOrder.get(b.id)!)

    // root → node order, with the structural virtual root (the only parentId-null
    // row) dropped: content paths start at the first-turn message, not the
    // content-less root.
    const chain = ordered.reverse()
    return chain[0]?.parentId === null ? chain.slice(1) : chain
  }

  /**
   * Copy one contiguous root -> node path into another topic.
   *
   * `rows` must be the ordered chain returned by `getPathRowsToNodeTx`; callers
   * should not pass arbitrary or forked message sets. The copy preserves the
   * renderable message content and terminal runtime metadata, but intentionally
   * does not copy `traceId`: trace links describe the original conversation run,
   * while the duplicated topic starts without trace linkage.
   */
  async copyPathRowsTx(
    tx: DbOrTx,
    rows: MessageRow[],
    options: { topicId: string }
  ): Promise<{ copiedMessageIds: Map<string, string>; copiedActiveNodeId: string }> {
    if (rows.length === 0) {
      throw DataApiErrorFactory.invalidOperation('copy message path', 'Source path is empty')
    }

    // The destination topic's virtual root; the path head (first-turn message, whose
    // source parent is the source's excluded virtual root) reparents onto it.
    const destRootId = await this.getRootMessageIdTx(tx, options.topicId)

    const copiedMessageIds = new Map<string, string>()
    let copiedActiveNodeId = ''

    for (const sourceMessage of rows) {
      let copiedParentId: string
      if (sourceMessage.parentId && copiedMessageIds.has(sourceMessage.parentId)) {
        copiedParentId = copiedMessageIds.get(sourceMessage.parentId)!
      } else {
        // Head of the path: its source parent is the (excluded) source virtual root,
        // so attach to the destination topic's virtual root.
        copiedParentId = destRootId
      }
      const [copiedMessage] = await tx
        .insert(messageTable)
        .values({
          topicId: options.topicId,
          parentId: copiedParentId,
          role: sourceMessage.role,
          data: sourceMessage.data,
          // A copied pending row has no stream owner; make it terminal.
          status: sourceMessage.status === 'pending' ? 'error' : sourceMessage.status,
          siblingsGroupId: 0,
          modelId: sourceMessage.modelId,
          modelSnapshot: sourceMessage.modelSnapshot,
          stats: sourceMessage.stats
        })
        .returning()

      copiedMessageIds.set(sourceMessage.id, copiedMessage.id)
      copiedActiveNodeId = copiedMessage.id
    }

    return { copiedMessageIds, copiedActiveNodeId }
  }

  /**
   * Read-only path query for branch-aware UI.
   *
   * Returns the conversation path that passes through `nodeId` and
   * descends into its subtree to the leaf with the greatest `created_at`
   * (skipping deleted nodes). If `nodeId` has no live children, the leaf
   * is `nodeId` itself.
   *
   * Pure read — does not touch `topic.activeNodeId`. Callers that want to
   * persist a navigation result should follow up with `setActiveNode`.
   */
  async getPathThrough(topicId: string, nodeId: string): Promise<Message[]> {
    const db = application.get('DbService').getDb()

    const [node] = await db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.id, nodeId), eq(messageTable.topicId, topicId), isNull(messageTable.deletedAt)))
      .limit(1)
    if (!node) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    const [leaf] = await db.all<{ id: string }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id, created_at FROM message
          WHERE id = ${nodeId} AND topic_id = ${topicId} AND deleted_at IS NULL
        UNION ALL
        SELECT m.id, m.created_at FROM message m
          INNER JOIN subtree s ON m.parent_id = s.id
          WHERE m.topic_id = ${topicId} AND m.deleted_at IS NULL
      )
      SELECT s.id FROM subtree s
      WHERE NOT EXISTS (
        SELECT 1 FROM message c
        WHERE c.parent_id = s.id AND c.topic_id = ${topicId} AND c.deleted_at IS NULL
      )
      ORDER BY s.created_at DESC
      LIMIT 1
    `)

    const pathRows = await this.getPathRowsToNodeTx(db, leaf?.id ?? nodeId, { topicId })
    return pathRows.map(rowToMessage)
  }
}

export const messageService = new MessageService()

registerDataService('MessageService', messageService)
