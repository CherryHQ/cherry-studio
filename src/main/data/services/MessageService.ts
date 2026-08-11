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
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { type MessageRow, messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
import { applyApprovalDecisions, type ApprovalDecision, blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  ActiveNodeStrategy,
  CreateMessageDto,
  DeleteMessageResponse,
  UpdateMessageDto
} from '@shared/data/api/schemas/messages'
import type { TopicMessageContentSearchItem } from '@shared/data/api/schemas/search'
import type { chatMessageRoles } from '@shared/data/types/file'
import {
  type BranchMessage,
  type BranchMessagesResponse,
  type CherryMessagePart,
  coerceSearchRole,
  type Message,
  type MessageData,
  type MessageRuntimeStatsInput,
  type MessageStats,
  type SiblingsGroup,
  toContentRole,
  TOPIC_MESSAGE_SEARCH_ROLES,
  type TreeNode,
  type TreeResponse
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { hasClearContextPart, isBlankUserTurn, readCherryMeta } from '@shared/data/types/uiParts'
import { isToolUIPart } from 'ai'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { aiUsageRecordService, mergeMessageRuntimeStats } from './AiUsageRecordService'
import { getDataService, registerDataService } from './dataServiceRegistry'
import { isAssistantActivityTransition, isConversationActivityRole } from './utils/activityTime'
import { type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MessageService')
const SQLITE_INARRAY_CHUNK = 500
const SQLITE_INSERT_CHUNK = 100

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
  userMessage:
    | { mode: 'create'; dto: CreateMessageDto }
    | { mode: 'existing'; id: string }
    | { mode: 'fill-reserved'; id: string; data: MessageData; modelId?: UniqueModelId }
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

function notifyTopicActivityChange(topicIds: readonly string[]): void {
  if (topicIds.length === 0) return
  const entityIds = [...new Set(topicIds)]
  notifyDataApiDataChange([
    { endpoint: '/topics', kind: 'projection', entityIds },
    { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds },
    { endpoint: '/topics/:id', entityIds },
    { endpoint: '/topics/latest' }
  ])
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
    messageSnapshot: parseJson(row.messageSnapshot),
    stats: parseJson(row.stats),
    compactionSummary: row.compactionSummary ?? null,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function completeApprovalWait(
  existing: MessageStats | null | undefined,
  approvalId: string,
  completedAt: number
): MessageStats | undefined {
  const runtimeTiming = existing?.runtimeTiming
  if (!runtimeTiming) return existing ?? undefined

  const spans = runtimeTiming.spans.map((span) =>
    span.kind === 'approval-wait' && span.approvalId === approvalId && span.completedAt === undefined
      ? { ...span, completedAt: Math.max(span.startedAt, completedAt) }
      : span
  )
  if (spans.every((span, index) => span === runtimeTiming.spans[index])) return existing ?? undefined

  return mergeMessageRuntimeStats(existing, {
    runtimeTiming: {
      ...runtimeTiming,
      spans
    }
  })
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

type ChatMessageFileRefEntry = { fileEntryId: string; role: (typeof chatMessageRoles)[number] }

function extractChatMessageFileRefs(data: MessageData | null | undefined): ChatMessageFileRefEntry[] {
  const refs: ChatMessageFileRefEntry[] = []
  const seen = new Set<string>()
  const add = (fileEntryId: string | undefined, role: ChatMessageFileRefEntry['role']) => {
    if (!fileEntryId) return
    const key = `${role}:${fileEntryId}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ fileEntryId, role })
  }
  for (const part of data?.parts ?? []) {
    if (part.type === 'file') {
      add(readCherryMeta(part)?.fileEntryId, 'attachment')
    } else if (isToolUIPart(part) && part.state === 'output-available' && isPersistedToolOutput(part.output)) {
      for (const blob of blobRefsOf(part.output.$persistedToolOutput)) add(blob.fileEntryId, 'tool_output')
    }
  }
  return refs
}

function selectExistingFileEntryIdsTx(tx: DbOrTx, ids: readonly string[]): Set<string> {
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += SQLITE_INARRAY_CHUNK) {
    const chunk = ids.slice(i, i + SQLITE_INARRAY_CHUNK)
    const rows = tx
      .select({ id: fileEntryTable.id })
      .from(fileEntryTable)
      .where(inArray(fileEntryTable.id, chunk))
      .all()
    for (const row of rows) existing.add(row.id)
  }
  return existing
}

function replaceChatMessageFileRefsTx(tx: DbOrTx, messageId: string, data: MessageData): void {
  tx.delete(chatMessageFileRefTable).where(eq(chatMessageFileRefTable.sourceId, messageId)).run()

  const refs = extractChatMessageFileRefs(data)
  if (refs.length === 0) return

  const existingIds = selectExistingFileEntryIdsTx(
    tx,
    refs.map((r) => r.fileEntryId)
  )
  const now = Date.now()
  const rows: Array<typeof chatMessageFileRefTable.$inferInsert> = []
  for (const { fileEntryId, role } of refs) {
    if (!existingIds.has(fileEntryId)) continue
    rows.push({ fileEntryId, sourceId: messageId, role, createdAt: now, updatedAt: now })
  }

  if (rows.length !== refs.length) {
    logger.warn('Dropped chat message file refs without matching file_entry', {
      messageId,
      dropped: refs.length - rows.length,
      total: refs.length
    })
  }

  for (let i = 0; i < rows.length; i += SQLITE_INSERT_CHUNK) {
    tx.insert(chatMessageFileRefTable)
      .values(rows.slice(i, i + SQLITE_INSERT_CHUNK))
      .run()
  }
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
    isContextBoundary: hasClearContextPart(message.data.parts) || undefined,
    isAwaitingInput:
      isBlankUserTurn({ role: message.role, status: message.status, parts: message.data.parts }) && !hasChildren
        ? true
        : undefined,
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
  purgeByTopicIdsTx(tx: Pick<DbType, 'delete'>, topicIds: string[]): void {
    const uniqueTopicIds = Array.from(new Set(topicIds))
    if (uniqueTopicIds.length === 0) return

    tx.delete(messageTable).where(inArray(messageTable.topicId, uniqueTopicIds)).run()
  }

  /**
   * Get tree structure for visualization
   *
   * Optimized to avoid loading all messages:
   * 1. Uses CTE to get active path (single query)
   * 2. Uses CTE to get tree nodes within depth limit (single query)
   * 3. Fetches additional nodes for active path if beyond depth limit
   */
  getTree(topicId: string, options: { rootId?: string; nodeId?: string; depth?: number } = {}): TreeResponse {
    const db = application.get('DbService').getDb()
    const { depth = 1 } = options

    // Get topic to verify existence and get activeNodeId
    const [topic] = db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1).all()

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    const activeNodeId = options.nodeId || topic.activeNodeId

    // Build active path via CTE (single query)
    const activePath = new Set<string>()
    if (activeNodeId) {
      const pathRows = db.all<{ id: string; parent_id: string | null }>(sql`
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
    const [rootRow] = db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()
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
        ? db
            .select({ id: messageTable.id, createdAt: messageTable.createdAt })
            .from(messageTable)
            .where(
              and(
                eq(messageTable.topicId, topicId),
                eq(messageTable.parentId, virtualRootId),
                isNull(messageTable.deletedAt)
              )
            )
            .all()
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
    const treeDepthRows = db.all<{ id: string; tree_depth: number }>(sql`
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
        : db
            .select()
            .from(messageTable)
            .where(
              inArray(
                messageTable.id,
                treeDepthRows.map((r) => r.id)
              )
            )
            .all()

    const treeRows: Array<typeof messageTable.$inferSelect & { treeDepth: number }> = baseTreeRows.map((r) => ({
      ...r,
      treeDepth: depthByCteId.get(r.id)!
    }))

    // Also fetch active path nodes that might be beyond depth limit
    const treeNodeIds = new Set(treeRows.map((r) => r.id))
    const missingActivePathIds = [...activePath].filter((id) => !treeNodeIds.has(id))

    if (missingActivePathIds.length > 0) {
      const additionalRows = db
        .select()
        .from(messageTable)
        .where(and(inArray(messageTable.id, missingActivePathIds), isNull(messageTable.deletedAt)))
        .all()
      for (const row of additionalRows) {
        treeRows.push({ ...row, treeDepth: maxDepth + 1 })
        treeNodeIds.add(row.id)
      }
    }

    // Also need children of active path nodes for proper tree building
    // Get all children of active path nodes that we haven't loaded yet
    const activePathArray = [...activePath]
    if (activePathArray.length > 0 && treeNodeIds.size > 0) {
      const childrenRows = db
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
        .all()

      for (const row of childrenRows) {
        if (!treeNodeIds.has(row.id)) {
          treeRows.push({ ...row, treeDepth: maxDepth + 1 })
          treeNodeIds.add(row.id)
        }
      }
    } else if (activePathArray.length > 0) {
      // No tree nodes loaded yet, just get all children of active path
      const childrenRows = db
        .select()
        .from(messageTable)
        .where(and(inArray(messageTable.parentId, activePathArray), isNull(messageTable.deletedAt)))
        .all()

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
  getBranchMessages(
    topicId: string,
    options: { nodeId?: string; cursor?: string; limit?: number; includeSiblings?: boolean } = {}
  ): BranchMessagesResponse {
    const db = application.get('DbService').getDb()
    const { cursor, limit = DEFAULT_LIMIT, includeSiblings = true } = options

    // Get topic
    const [topic] = db.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1).all()

    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', topicId)
    }

    // Authoritative first-turn signal for renderers (pagination-independent): a message is a
    // first turn iff its parentId === this root id. Looked up once, returned in the response.
    const [rootRow] = db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()
    const rootId = rootRow?.id ?? null

    const nodeId = options.nodeId || topic.activeNodeId

    // Return empty if no active node
    if (!nodeId) {
      return { items: [], nextCursor: undefined, activeNodeId: null, assistantId: topic.assistantId, rootId }
    }

    const fullPath = this.getPathRowsToNodeTx(db, nodeId, { topicId })

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

        const siblingsRows = db
          .select()
          .from(messageTable)
          .where(and(isNull(messageTable.deletedAt), or(...orConditions)))
          .all()

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
  getById(id: string): Message {
    const db = application.get('DbService').getDb()

    const [row] = db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.id, id), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Message', id)
    }

    return rowToMessage(row)
  }

  /**
   * Ids of assistant rows still in `pending` — used by the boot reconcile of crash-orphaned turns.
   * Selects only `id` (reconcile just flips them to `error`); backed by `message_status_idx`.
   */
  findPendingAssistantMessageIds(): string[] {
    const db = application.get('DbService').getDb()
    const rows = db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(
        and(eq(messageTable.role, 'assistant'), eq(messageTable.status, 'pending'), isNull(messageTable.deletedAt))
      )
      .all()
    return rows.map((row) => row.id)
  }

  /**
   * Flip the given rows to `error` in a single write. Paired with
   * {@link findPendingAssistantMessages} for the boot reconcile of crash-orphaned `pending`
   * turns.
   */
  markMessagesError(ids: string[]): void {
    if (ids.length === 0) return
    application
      .get('DbService')
      .getDb()
      .update(messageTable)
      .set({ status: 'error' })
      .where(
        and(
          inArray(messageTable.id, ids),
          eq(messageTable.role, 'assistant'),
          eq(messageTable.status, 'pending'),
          isNull(messageTable.deletedAt)
        )
      )
      .run()
  }

  /** Persist the durable compaction summary onto a message row. Serialized via withWriteTx (sync). */
  setCompactionSummary(id: string, summary: string): void {
    application.get('DbService').withWriteTx((tx) => {
      tx.update(messageTable).set({ compactionSummary: summary }).where(eq(messageTable.id, id)).run()
    })
    logger.info('Set message compactionSummary', { id, length: summary.length })
  }

  search(query: MessageContentSearchInput) {
    const db = application.get('DbService').getDb()
    const topicConditionForMessageAlias = query.topicId ? sql`message.topic_id = ${query.topicId}` : sql`1 = 1`

    return searchWithCursor<MessageSearchRow, TopicMessageContentSearchItem>({
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      createdAtFrom: query.createdAtFrom,
      cursorConfig: MESSAGE_SEARCH_CURSOR_CONFIG,
      fetchRows: ({ ftsConditions, cursor, createdAtFromMs, offset, chunkSize }: SearchFetchContext) => {
        const createdAtConditionForMessageAlias =
          createdAtFromMs !== undefined ? sql`message.created_at >= ${createdAtFromMs}` : sql`1 = 1`

        return db.all<MessageSearchRow>(sql`
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
          JOIN message_fts fts ON message.fts_rowid = fts.rowid
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
  getChildrenByParentId(parentId: string): Message[] {
    const db = application.get('DbService').getDb()
    const rows = db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.parentId, parentId), isNull(messageTable.deletedAt)))
      .all()
    return rows.map(rowToMessage)
  }

  /** Update siblingsGroupId for a single message. */
  updateSiblingsGroupId(id: string, siblingsGroupId: number): void {
    const db = application.get('DbService').getDb()
    db.update(messageTable).set({ siblingsGroupId }).where(eq(messageTable.id, id)).run()
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
  createSibling(sourceId: string, data: MessageData): Message {
    const message = application.get('DbService').withWriteTx((tx) => {
      const [source] = tx.select().from(messageTable).where(eq(messageTable.id, sourceId)).limit(1).all()
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
        tx.update(messageTable).set({ siblingsGroupId }).where(eq(messageTable.id, sourceId)).run()
      }

      const status = source.role === 'user' ? 'success' : 'pending'
      const createdAt = Date.now()
      const [row] = tx
        .insert(messageTable)
        .values({
          topicId: source.topicId,
          parentId: source.parentId,
          role: source.role,
          data,
          status,
          siblingsGroupId,
          createdAt,
          updatedAt: createdAt
        })
        .returning()
        .all()
      replaceChatMessageFileRefsTx(tx, row.id, data)

      const topicService = getDataService('TopicService')
      topicService.setActiveNodeTx(tx, source.topicId, row.id, { assumeValid: true })
      if (isConversationActivityRole(source.role)) {
        topicService.advanceLastActivityAtTx(tx, source.topicId, createdAt)
      }

      logger.info('Created sibling message', {
        sourceId,
        newId: row.id,
        parentId: source.parentId,
        siblingsGroupId
      })

      return rowToMessage(row)
    })
    if (isConversationActivityRole(message.role)) {
      notifyTopicActivityChange([message.topicId])
    }
    return message
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
  createRootMessageTx(tx: DbOrTx, topicId: string): string {
    const [row] = tx
      .insert(messageTable)
      .values({ topicId, parentId: null, role: 'root', data: { parts: [] }, status: 'success', siblingsGroupId: 0 })
      .returning({ id: messageTable.id })
      .all()
    return row.id
  }

  /**
   * Return the topic's virtual-root message id. Every topic has exactly one, created
   * eagerly at topic creation, so message-creation paths just read it. Throws if absent
   * — a missing root means a topic-creation path failed to call {@link createRootMessageTx}.
   */
  getRootMessageIdTx(tx: DbOrTx, topicId: string): string {
    const [row] = tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.parentId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()
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
  create(topicId: string, dto: CreateMessageDto): Message {
    const message = application.get('DbService').withWriteTx((tx) => {
      // Step 1: Verify topic exists and fetch its current state.
      // We need the topic to check activeNodeId for parentId auto-resolution.
      const [topic] = tx.select().from(topicTable).where(eq(topicTable.id, topicId)).limit(1).all()

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
        resolvedParentId = topic.activeNodeId ?? this.getRootMessageIdTx(tx, topicId)
      } else if (dto.parentId === null) {
        // First-turn message: hang it off the topic's virtual root (created if absent).
        // First turns and their resends are ordinary siblings under this shared root.
        resolvedParentId = this.getRootMessageIdTx(tx, topicId)
      } else {
        // Explicit parent ID: verify existence and topic membership. Each
        // topic's message tree is self-contained — cross-topic parent refs
        // aren't a supported shape.
        const [parent] = tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1).all()

        if (!parent) {
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
        if (parent.topicId !== topicId) {
          throw DataApiErrorFactory.invalidOperation('create message', 'Parent message does not belong to this topic')
        }
        resolvedParentId = dto.parentId
      }

      // Step 3: Insert the message using the resolved parentId.
      const status = dto.status ?? 'pending'
      const createdAt = Date.now()
      const [row] = tx
        .insert(messageTable)
        .values({
          topicId,
          parentId: resolvedParentId,
          role: dto.role,
          data: dto.data,
          status,
          siblingsGroupId: dto.siblingsGroupId,
          modelId: dto.modelId ?? null,
          messageSnapshot: dto.messageSnapshot,
          createdAt,
          updatedAt: createdAt
        })
        .returning()
        .all()
      replaceChatMessageFileRefsTx(tx, row.id, dto.data)

      const topicService = getDataService('TopicService')

      // Update activeNodeId if setAsActive is not explicitly false
      if (dto.setAsActive !== false) {
        topicService.setActiveNodeTx(tx, topicId, row.id, { assumeValid: true })
      }
      if (isConversationActivityRole(dto.role)) {
        topicService.advanceLastActivityAtTx(tx, topicId, createdAt)
      }

      logger.info('Created message', { id: row.id, topicId, role: dto.role, setAsActive: dto.setAsActive !== false })

      return rowToMessage(row)
    })
    if (isConversationActivityRole(message.role)) {
      notifyTopicActivityChange([topicId])
    }
    return message
  }

  /**
   * Persist a distinct empty branch below an assistant message.
   *
   * Reserved branches are intentional user-created tree nodes: repeated calls below
   * the same anchor always create another row. `activate=false` lets the branch manager
   * place a reservation without moving the topic away from a currently streaming path.
   */
  reserveBranch(anchorId: string, activate: boolean = true): Message {
    const message = application.get('DbService').withWriteTx((tx) => {
      const [anchor] = tx
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.id, anchorId), isNull(messageTable.deletedAt)))
        .limit(1)
        .all()
      if (!anchor) {
        throw DataApiErrorFactory.notFound('Message', anchorId)
      }
      if (anchor.role !== 'assistant') {
        throw DataApiErrorFactory.invalidOperation('reserve branch', 'the branch anchor must be an assistant message')
      }

      const createdAt = Date.now()
      const [row] = tx
        .insert(messageTable)
        .values({
          topicId: anchor.topicId,
          parentId: anchor.id,
          role: 'user',
          data: { parts: [] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt,
          updatedAt: createdAt
        })
        .returning()
        .all()

      const topicService = getDataService('TopicService')

      if (activate) {
        topicService.setActiveNodeTx(tx, anchor.topicId, row.id, { assumeValid: true })
      }
      topicService.advanceLastActivityAtTx(tx, anchor.topicId, createdAt)

      logger.info('Reserved message branch', { anchorId, branchId: row.id, topicId: anchor.topicId, activate })
      return rowToMessage(row)
    })
    notifyTopicActivityChange([message.topicId])
    return message
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
   * - `mode: 'fill-reserved'`: caller supplies a persisted blank user leaf plus
   *   its first-turn content. The fill and assistant placeholders commit together.
   *
   * Siblings backfill: if `siblingsGroupId` is provided, any existing children
   * of the user message whose `siblingsGroupId = 0` are backfilled to it. This
   * is a no-op when there are no existing children (fresh turn) or when they
   * already belong to a group (inherit case).
   */
  createUserMessageWithPlaceholders(
    input: CreateUserMessageWithPlaceholdersInput
  ): CreateUserMessageWithPlaceholdersResult {
    let activityChanged = false
    const result = application.get('DbService').withWriteTx((tx) => {
      // Validate topic
      const [topic] = tx.select().from(topicTable).where(eq(topicTable.id, input.topicId)).limit(1).all()
      if (!topic) {
        throw DataApiErrorFactory.notFound('Topic', input.topicId)
      }
      let latestActivityAt: number | null = null

      // 1. Resolve user message — insert new, or fetch existing
      let userMessage: Message
      if (input.userMessage.mode === 'create') {
        const dto = input.userMessage.dto
        let resolvedParentId: string | null

        if (dto.parentId === undefined || dto.parentId === null) {
          // First-turn message: hang it off the topic's virtual root (created if absent).
          resolvedParentId = this.getRootMessageIdTx(tx, input.topicId)
        } else {
          const [parent] = tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1).all()
          if (!parent) {
            throw DataApiErrorFactory.notFound('Message', dto.parentId)
          }
          if (parent.topicId !== input.topicId) {
            throw DataApiErrorFactory.invalidOperation('create message', 'Parent message does not belong to this topic')
          }
          resolvedParentId = dto.parentId
        }

        const status = dto.status ?? 'pending'
        const createdAt = Date.now()
        const [row] = tx
          .insert(messageTable)
          .values({
            topicId: input.topicId,
            parentId: resolvedParentId,
            role: dto.role,
            data: dto.data,
            status,
            ...(dto.siblingsGroupId !== undefined ? { siblingsGroupId: dto.siblingsGroupId } : {}),
            modelId: dto.modelId,
            messageSnapshot: dto.messageSnapshot,
            createdAt,
            updatedAt: createdAt
          })
          .returning()
          .all()
        replaceChatMessageFileRefsTx(tx, row.id, dto.data)
        userMessage = rowToMessage(row)
        if (isConversationActivityRole(dto.role)) latestActivityAt = createdAt
      } else if (input.userMessage.mode === 'existing') {
        const [row] = tx.select().from(messageTable).where(eq(messageTable.id, input.userMessage.id)).limit(1).all()
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
      } else {
        const [row] = tx
          .select()
          .from(messageTable)
          .where(and(eq(messageTable.id, input.userMessage.id), isNull(messageTable.deletedAt)))
          .limit(1)
          .all()
        if (!row) {
          throw DataApiErrorFactory.notFound('Message', input.userMessage.id)
        }
        if (row.topicId !== input.topicId) {
          throw DataApiErrorFactory.invalidOperation('fill reserved branch', 'Message does not belong to this topic')
        }

        const existing = rowToMessage(row)
        if ((input.userMessage.data.parts?.length ?? 0) === 0 || !this.isAwaitingInputLeafTx(tx, existing)) {
          throw DataApiErrorFactory.invalidOperation(
            'fill reserved branch',
            'the message is no longer an empty user leaf'
          )
        }

        const activityTimestamp = Date.now()
        const [updatedRow] = tx
          .update(messageTable)
          .set({
            data: input.userMessage.data,
            ...(input.userMessage.modelId ? { modelId: input.userMessage.modelId } : {})
          })
          .where(eq(messageTable.id, row.id))
          .returning()
          .all()
        replaceChatMessageFileRefsTx(tx, row.id, input.userMessage.data)
        userMessage = rowToMessage(updatedRow)
        latestActivityAt = activityTimestamp
      }

      // 2. Backfill siblings with groupId=0 under the user message
      if (input.siblingsGroupId != null) {
        tx.update(messageTable)
          .set({ siblingsGroupId: input.siblingsGroupId })
          .where(and(eq(messageTable.parentId, userMessage.id), eq(messageTable.siblingsGroupId, 0)))
          .run()
      }

      // 3. Insert placeholders (preserving input order)
      const placeholders: Message[] = []
      for (const p of input.placeholders) {
        const status = p.status ?? 'pending'
        const createdAt = Date.now()
        const [row] = tx
          .insert(messageTable)
          .values({
            ...(p.id && { id: p.id }),
            topicId: input.topicId,
            parentId: userMessage.id,
            role: p.role,
            data: p.data,
            status,
            ...(input.siblingsGroupId !== undefined ? { siblingsGroupId: input.siblingsGroupId } : {}),
            modelId: p.modelId,
            messageSnapshot: p.messageSnapshot,
            createdAt,
            updatedAt: createdAt
          })
          .returning()
          .all()
        replaceChatMessageFileRefsTx(tx, row.id, p.data)
        placeholders.push(rowToMessage(row))
        if (isConversationActivityRole(p.role)) {
          latestActivityAt = latestActivityAt === null ? createdAt : Math.max(latestActivityAt, createdAt)
        }
      }

      // 4. Point activeNodeId at the last placeholder (or user message if N=0)
      const newActiveNodeId = placeholders.at(-1)?.id ?? userMessage.id
      const topicService = getDataService('TopicService')
      topicService.setActiveNodeTx(tx, input.topicId, newActiveNodeId, { assumeValid: true })
      if (latestActivityAt !== null) {
        topicService.advanceLastActivityAtTx(tx, input.topicId, latestActivityAt)
        activityChanged = true
      }

      logger.info('Reserved assistant turn', {
        topicId: input.topicId,
        userMessageId: userMessage.id,
        placeholderIds: placeholders.map((p) => p.id),
        siblingsGroupId: input.siblingsGroupId
      })

      return { userMessage, placeholders }
    })
    if (activityChanged) notifyTopicActivityChange([input.topicId])
    return result
  }

  private isAwaitingInputLeafTx(tx: DbOrTx, message: Message): boolean {
    if (!isBlankUserTurn({ role: message.role, status: message.status, parts: message.data.parts })) return false

    const child = tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(eq(messageTable.parentId, message.id), isNull(messageTable.deletedAt)))
      .limit(1)
      .get()
    return child === undefined
  }

  isAwaitingInputLeaf(id: string, topicId: string): boolean {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.id, id), eq(messageTable.topicId, topicId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()
    return row ? this.isAwaitingInputLeafTx(db, rowToMessage(row)) : false
  }

  /**
   * Update a message
   *
   * Uses transaction to ensure atomicity of validation and update.
   * Cycle check is performed outside transaction as a read-only safety check.
   */
  update(id: string, dto: UpdateMessageDto): Message {
    // Pre-transaction: Check for cycle if moving to new parent
    // This is done outside transaction since getDescendantIds uses its own db context
    // and cycle check is a safety check (worst case: reject valid operation)
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const descendants = this.getDescendantIds(id)
      if (descendants.includes(dto.parentId)) {
        throw DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
      }
    }

    let activityChanged = false
    const message = application.get('DbService').withWriteTx((tx) => {
      // Get existing message within transaction
      const [existingRow] = tx.select().from(messageTable).where(eq(messageTable.id, id)).limit(1).all()

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
        const [parent] = tx.select().from(messageTable).where(eq(messageTable.id, dto.parentId)).limit(1).all()

        if (!parent) {
          throw DataApiErrorFactory.notFound('Message', dto.parentId)
        }
      }

      // Build update object
      const updates: Partial<typeof messageTable.$inferInsert> = {}

      if (dto.data !== undefined) updates.data = dto.data
      if (dto.parentId !== undefined) updates.parentId = dto.parentId
      if (dto.siblingsGroupId !== undefined) updates.siblingsGroupId = dto.siblingsGroupId
      let activityTransitionAt: number | null = null
      if (dto.status !== undefined) {
        updates.status = dto.status
        if (
          isAssistantActivityTransition({
            existingStatus: existingRow.status,
            role: existingRow.role,
            status: dto.status
          })
        ) {
          activityTransitionAt = Date.now()
        }
      }

      const [row] = tx.update(messageTable).set(updates).where(eq(messageTable.id, id)).returning().all()
      if (dto.data !== undefined) {
        replaceChatMessageFileRefsTx(tx, id, dto.data)
      }
      if (activityTransitionAt !== null) {
        getDataService('TopicService').advanceLastActivityAtTx(tx, existingRow.topicId, activityTransitionAt)
        activityChanged = true
      }

      logger.info('Updated message', { id, changes: Object.keys(dto) })

      return rowToMessage(row)
    })

    if (activityChanged) notifyTopicActivityChange([message.topicId])
    return message
  }

  /**
   * Internal AI-runtime finalizer. Content/status and runtime stats are
   * message-owned; the merge preserves the existing record-owned usage
   * projection and never accepts usage/cost from this caller.
   */
  finalizeAssistantMessage(
    id: string,
    input: {
      data: MessageData
      status: Extract<Message['status'], 'success' | 'paused' | 'error'>
      runtimeStats?: MessageRuntimeStatsInput
    }
  ): Message {
    let activityTopicId: string | null = null
    application.get('DbService').withWriteTx((tx) => {
      const row = tx.select().from(messageTable).where(eq(messageTable.id, id)).get()
      if (!row) throw DataApiErrorFactory.notFound('Message', id)
      if (row.role !== 'assistant') {
        throw DataApiErrorFactory.invalidOperation('finalize message', 'only assistant messages can be finalized')
      }

      const stats = mergeMessageRuntimeStats(row.stats, input.runtimeStats)
      const activityTimestamp = isAssistantActivityTransition({
        existingStatus: row.status,
        role: row.role,
        status: input.status
      })
        ? Date.now()
        : null
      tx.update(messageTable)
        .set({
          data: input.data,
          status: input.status,
          stats: stats ?? null
        })
        .where(eq(messageTable.id, id))
        .run()
      replaceChatMessageFileRefsTx(tx, id, input.data)
      if (activityTimestamp !== null) {
        getDataService('TopicService').advanceLastActivityAtTx(tx, row.topicId, activityTimestamp)
        activityTopicId = row.topicId
      }
    })
    if (activityTopicId) notifyTopicActivityChange([activityTopicId])
    aiUsageRecordService.refreshMessageProjection({ kind: 'chat', id })
    const finalized = this.getById(id)
    if (!finalized) throw DataApiErrorFactory.notFound('Message', id)
    return finalized
  }

  /**
   * Provisional `tool_output` file ref written at offload time, before the
   * assistant turn finalizes. Protects a freshly-created
   * `delete_when_unreferenced` blob from the entry-cleanup reaper during turns
   * longer than the 1h create grace; `finalizeAssistantMessage`'s ref replace
   * later converges the set to the final parts. Returns false (no-op) when the
   * message row doesn't exist — a FK violation would not be absorbed by the
   * conflict clause — or when the ref is already present.
   */
  addToolOutputFileRef(messageId: string, fileEntryId: string): boolean {
    return application.get('DbService').withWriteTx((tx) => {
      const row = tx.select({ id: messageTable.id }).from(messageTable).where(eq(messageTable.id, messageId)).get()
      if (!row) return false
      const now = Date.now()
      const result = tx
        .insert(chatMessageFileRefTable)
        .values({ fileEntryId, sourceId: messageId, role: 'tool_output', createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run()
      return result.changes > 0
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
  applyToolApprovalDecisions(
    anchorId: string,
    decisions: ApprovalDecision[]
  ): {
    parts: CherryMessagePart[]
    appliedApprovalIds: string[]
    alreadySettledApprovalIds: string[]
  } | null {
    const completedAt = Date.now()
    const result = application.get('DbService').withWriteTx((tx) => {
      const [row] = tx.select().from(messageTable).where(eq(messageTable.id, anchorId)).limit(1).all()
      if (!row) return { response: null, activityTopicId: null }

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
        const stats = appliedApprovalIds.reduce(
          (current, approvalId) => completeApprovalWait(current, approvalId, completedAt),
          existing.stats ?? undefined
        )
        tx.update(messageTable)
          .set({ data: { ...existing.data, parts: after }, stats: stats ?? null })
          .where(eq(messageTable.id, anchorId))
          .run()
        getDataService('TopicService').advanceLastActivityAtTx(tx, row.topicId, completedAt)
      }
      return {
        response: { parts: after, appliedApprovalIds, alreadySettledApprovalIds },
        activityTopicId: targetPresent ? row.topicId : null
      }
    })
    if (result.activityTopicId) notifyTopicActivityChange([result.activityTopicId])
    return result.response
  }

  /**
   * Delete the complete assistant reply group containing `id`, preserving descendants.
   *
   * Group membership is resolved from the database inside the write transaction so the
   * renderer cannot accidentally omit hidden or newly-created siblings. A zero group id
   * represents an ungrouped reply and therefore deletes only the requested message.
   */
  deleteReplyGroup(id: string): DeleteMessageResponse {
    const result = application.get('DbService').withWriteTx((tx) => {
      const [target] = tx
        .select({
          id: messageTable.id,
          parentId: messageTable.parentId,
          topicId: messageTable.topicId,
          role: messageTable.role,
          status: messageTable.status,
          siblingsGroupId: messageTable.siblingsGroupId
        })
        .from(messageTable)
        .where(and(eq(messageTable.id, id), isNull(messageTable.deletedAt)))
        .limit(1)
        .all()

      if (!target) throw DataApiErrorFactory.notFound('Message', id)
      if (!target.parentId || target.role !== 'assistant') {
        throw DataApiErrorFactory.invalidOperation(
          'delete message group',
          'only an assistant reply can identify a reply group'
        )
      }

      const targets =
        target.siblingsGroupId === 0
          ? [target]
          : tx
              .select({
                id: messageTable.id,
                parentId: messageTable.parentId,
                topicId: messageTable.topicId,
                role: messageTable.role,
                status: messageTable.status,
                siblingsGroupId: messageTable.siblingsGroupId
              })
              .from(messageTable)
              .where(
                and(
                  eq(messageTable.parentId, target.parentId),
                  eq(messageTable.topicId, target.topicId),
                  eq(messageTable.role, 'assistant'),
                  eq(messageTable.siblingsGroupId, target.siblingsGroupId),
                  isNull(messageTable.deletedAt)
                )
              )
              .all()

      if (targets.some((message) => message.status === 'pending')) {
        throw DataApiErrorFactory.invalidOperation('delete message group', 'a reply in the group is still generating')
      }

      const targetIds = targets.map((message) => message.id)

      const [topic] = tx.select().from(topicTable).where(eq(topicTable.id, target.topicId)).limit(1).all()
      if (!topic) throw DataApiErrorFactory.notFound('Topic', target.topicId)

      const reparentedIds = this.reparentChildrenTx(tx, targets)
      let newActiveNodeId: string | null | undefined

      if (topic.activeNodeId && targetIds.includes(topic.activeNodeId)) {
        newActiveNodeId = this.resolveActiveNodeFallbackTx(tx, target.parentId)
      }

      tx.delete(messageTable).where(inArray(messageTable.id, targetIds)).run()

      if (newActiveNodeId !== undefined) {
        const topicService = getDataService('TopicService')
        if (newActiveNodeId === null) {
          topicService.clearActiveNodeTx(tx, target.topicId)
        } else {
          topicService.setActiveNodeTx(tx, target.topicId, newActiveNodeId, { assumeValid: true })
        }
      }

      return {
        deletedIds: targetIds,
        reparentedIds: reparentedIds.length > 0 ? reparentedIds : undefined,
        newActiveNodeId
      }
    })

    logger.info('Deleted assistant reply group with reparenting', {
      count: result.deletedIds.length,
      reparentedCount: result.reparentedIds?.length ?? 0
    })
    return result
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
   * @param awaitingInputOnly - Reject unless the target is an awaiting-input user leaf
   * @returns Deletion result including deletedIds, reparentedIds, and newActiveNodeId
   * @throws NOT_FOUND if message doesn't exist
   * @throws INVALID_OPERATION if the target is the topic's virtual root (removable only
   *   via topic deletion; clear-all deletes the root's children instead)
   */
  delete(
    id: string,
    cascade: boolean = false,
    activeNodeStrategy: ActiveNodeStrategy = 'parent',
    awaitingInputOnly: boolean = false
  ): DeleteMessageResponse {
    const result = application.get('DbService').withWriteTx((tx) => {
      const [messageRow] = tx
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.id, id), isNull(messageTable.deletedAt)))
        .limit(1)
        .all()
      if (!messageRow) {
        throw DataApiErrorFactory.notFound('Message', id)
      }
      const message = rowToMessage(messageRow)

      const [topic] = tx.select().from(topicTable).where(eq(topicTable.id, message.topicId)).limit(1).all()
      if (!topic) {
        throw DataApiErrorFactory.notFound('Topic', message.topicId)
      }

      // The virtual root is structural — deleting it would orphan first-turn children
      // or leave a rootless topic. It is removable only via topic deletion (FK cascade).
      if (message.role === 'root' || message.parentId === null) {
        throw DataApiErrorFactory.invalidOperation('delete root message', 'the virtual root cannot be deleted')
      }

      if (awaitingInputOnly && !this.isAwaitingInputLeafTx(tx, message)) {
        throw DataApiErrorFactory.invalidOperation(
          'delete awaiting-input message',
          'the message is no longer an empty user leaf'
        )
      }

      const descendantIds = cascade ? this.getDescendantIdsTx(tx, id) : []
      let deletedIds: string[]
      let reparentedIds: string[] | undefined
      let newActiveNodeId: string | null | undefined

      // The virtual root is structural and never a valid active node.
      const parentFallback = this.resolveActiveNodeFallbackTx(tx, message.parentId)

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
        tx.delete(messageTable).where(eq(messageTable.id, id)).run()

        logger.info('Cascade deleted messages', { rootId: id, count: deletedIds.length })
      } else {
        // Splice this node out: reparent its children onto its parent (their grandparent).
        reparentedIds = this.reparentChildrenTx(tx, [message])

        deletedIds = [id]

        // Check if activeNodeId is affected
        if (topic.activeNodeId === id) {
          newActiveNodeId = activeNodeStrategy === 'clear' ? null : parentFallback
        }

        // Hard delete this message
        tx.delete(messageTable).where(eq(messageTable.id, id)).run()

        logger.info('Deleted message with reparenting', { id, reparentedCount: reparentedIds.length })
      }

      const topicService = getDataService('TopicService')

      // Update topic.activeNodeId if needed
      if (newActiveNodeId !== undefined) {
        if (newActiveNodeId === null) {
          topicService.clearActiveNodeTx(tx, message.topicId)
        } else {
          topicService.setActiveNodeTx(tx, message.topicId, newActiveNodeId, { assumeValid: true })
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
    return result
  }

  private resolveActiveNodeFallbackTx(tx: DbOrTx, parentId: string | null): string | null {
    if (!parentId) return null

    const [parent] = tx
      .select({ role: messageTable.role })
      .from(messageTable)
      .where(and(eq(messageTable.id, parentId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()

    return !parent || parent.role === 'root' ? null : parentId
  }

  private reparentChildrenTx(tx: DbOrTx, targets: Array<Pick<MessageRow, 'id' | 'parentId'>>): string[] {
    const targetIds = targets.map((target) => target.id)
    const newParentId = targets[0]?.parentId ?? null
    const children = tx
      .select({
        id: messageTable.id,
        parentId: messageTable.parentId,
        siblingsGroupId: messageTable.siblingsGroupId
      })
      .from(messageTable)
      .where(and(inArray(messageTable.parentId, targetIds), isNull(messageTable.deletedAt)))
      .all()

    if (children.length === 0) return []

    // siblingsGroupId is relative to the parent. Rebase each moved non-zero group
    // to a fresh id so groups from different deleted replies cannot collide with
    // each other or with an unrelated group already under the destination parent.
    const destRows = newParentId
      ? tx
          .select({ g: messageTable.siblingsGroupId })
          .from(messageTable)
          .where(and(eq(messageTable.parentId, newParentId), isNull(messageTable.deletedAt)))
          .all()
      : []
    let nextGroupId =
      Math.max(0, ...destRows.map((row) => row.g), ...children.map((child) => child.siblingsGroupId)) + 1
    const remap = new Map<string, number>()

    for (const child of children) {
      if (child.siblingsGroupId === 0) continue
      const sourceGroup = `${child.parentId}:${child.siblingsGroupId}`
      if (!remap.has(sourceGroup)) remap.set(sourceGroup, nextGroupId++)
    }

    for (const child of children) {
      const sourceGroup = `${child.parentId}:${child.siblingsGroupId}`
      tx.update(messageTable)
        .set({
          parentId: newParentId,
          siblingsGroupId: child.siblingsGroupId === 0 ? 0 : remap.get(sourceGroup)!
        })
        .where(eq(messageTable.id, child.id))
        .run()
    }

    return children.map((child) => child.id)
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
  clearTopicMessages(topicId: string): { deletedIds: string[] } {
    const result = application.get('DbService').withWriteTx((tx) => {
      const rootId = this.getRootMessageIdTx(tx, topicId)

      const rows = tx
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(and(eq(messageTable.topicId, topicId), ne(messageTable.id, rootId), isNull(messageTable.deletedAt)))
        .all()
      const deletedIds = rows.map((r) => r.id)

      if (deletedIds.length === 0) return { deletedIds }

      tx.delete(messageTable)
        .where(and(eq(messageTable.topicId, topicId), ne(messageTable.id, rootId)))
        .run()
      const topicService = getDataService('TopicService')
      topicService.clearActiveNodeTx(tx, topicId)

      logger.info('Cleared topic messages', { topicId, count: deletedIds.length })
      return { deletedIds }
    })
    return result
  }

  /**
   * Get all descendant IDs of a message
   */
  private getDescendantIds(id: string): string[] {
    return this.getDescendantIdsTx(application.get('DbService').getDb(), id)
  }

  private getDescendantIdsTx(tx: DbOrTx, id: string): string[] {
    // Use recursive query to get all descendants
    const result = tx.all<{ id: string }>(sql`
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
  getPathToNode(nodeId: string): Message[] {
    const db = application.get('DbService').getDb()
    const pathRows = this.getPathRowsToNodeTx(db, nodeId)
    return pathRows.map(rowToMessage)
  }

  /**
   * Transaction-aware root -> node path helper. When `topicId` is provided, the
   * full ancestor walk is scoped to that topic so copy/navigation callers keep
   * the same-topic message-tree invariant.
   */
  getPathRowsToNodeTx(tx: DbOrTx, nodeId: string, options: { topicId?: string } = {}): MessageRow[] {
    // Recursive CTE collects ancestor IDs (single-column, casing-safe);
    // full rows fetched via ORM for camelCase mapping.
    const ancestorIdRows = options.topicId
      ? tx.all<{ id: string }>(sql`
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
      : tx.all<{ id: string }>(sql`
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
    const ancestorRows = tx.select().from(messageTable).where(whereClause).all()

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
   * renderable message content and message-owned timings, but not usage/cost:
   * those remain projected from records associated with the original message
   * ids. It also intentionally does not copy `traceId`: trace links describe
   * the original conversation run, while the duplicated topic starts without
   * trace linkage.
   */
  copyPathRowsTx(
    tx: DbOrTx,
    rows: MessageRow[],
    options: { topicId: string }
  ): { copiedMessageIds: Map<string, string>; copiedActiveNodeId: string } {
    if (rows.length === 0) {
      throw DataApiErrorFactory.invalidOperation('copy message path', 'Source path is empty')
    }

    // The destination topic's virtual root; the path head (first-turn message, whose
    // source parent is the source's excluded virtual root) reparents onto it.
    const destRootId = this.getRootMessageIdTx(tx, options.topicId)

    const copiedMessageIds = new Map<string, string>()
    let copiedActiveNodeId = ''

    for (const sourceMessage of rows) {
      const copiedStats: MessageStats = {
        ...(sourceMessage.stats?.timeFirstTokenMs !== undefined
          ? { timeFirstTokenMs: sourceMessage.stats.timeFirstTokenMs }
          : {}),
        ...(sourceMessage.stats?.timeCompletionMs !== undefined
          ? { timeCompletionMs: sourceMessage.stats.timeCompletionMs }
          : {}),
        ...(sourceMessage.stats?.timeThinkingMs !== undefined
          ? { timeThinkingMs: sourceMessage.stats.timeThinkingMs }
          : {}),
        ...(sourceMessage.stats?.runtimeTiming ? { runtimeTiming: sourceMessage.stats.runtimeTiming } : {})
      }
      let copiedParentId: string
      if (sourceMessage.parentId && copiedMessageIds.has(sourceMessage.parentId)) {
        copiedParentId = copiedMessageIds.get(sourceMessage.parentId)!
      } else {
        // Head of the path: its source parent is the (excluded) source virtual root,
        // so attach to the destination topic's virtual root.
        copiedParentId = destRootId
      }
      // A copied pending row has no stream owner; make it terminal.
      const status = sourceMessage.status === 'pending' ? 'error' : sourceMessage.status
      const createdAt = Date.now()
      const [copiedMessage] = tx
        .insert(messageTable)
        .values({
          topicId: options.topicId,
          parentId: copiedParentId,
          role: sourceMessage.role,
          data: sourceMessage.data,
          status,
          siblingsGroupId: 0,
          modelId: sourceMessage.modelId,
          messageSnapshot: sourceMessage.messageSnapshot,
          stats: Object.keys(copiedStats).length > 0 ? copiedStats : null,
          createdAt,
          updatedAt: createdAt
        })
        .returning()
        .all()

      copiedMessageIds.set(sourceMessage.id, copiedMessage.id)
      copiedActiveNodeId = copiedMessage.id
    }

    // File refs are NOT re-derived here: the sole caller (TopicService.duplicate)
    // copies the source rows' refs verbatim by source-id map afterwards
    // (role-preserving, so `tool_output` refs ride along) — deriving them here
    // too would collide on the (entry, source, role) unique index.
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
  getPathThrough(topicId: string, nodeId: string): Message[] {
    const db = application.get('DbService').getDb()

    const [node] = db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.id, nodeId), eq(messageTable.topicId, topicId), isNull(messageTable.deletedAt)))
      .limit(1)
      .all()
    if (!node) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    const [leaf] = db.all<{ id: string }>(sql`
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

    const pathRows = this.getPathRowsToNodeTx(db, leaf?.id ?? nodeId, { topicId })
    return pathRows.map(rowToMessage)
  }
}

export const messageService = new MessageService()

registerDataService('MessageService', messageService)
