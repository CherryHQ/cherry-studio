import { createHash } from 'node:crypto'

import { isDataUIPart, isToolUIPart } from 'ai'
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  notInArray,
  or,
  type SQL,
  sql
} from 'drizzle-orm'
import { chunk } from 'es-toolkit'
import { v4 as uuidv4, v7 as uuidv7, validate as isUuid } from 'uuid'

import { application } from '@application'
import { isAcceptedToolPart } from '@cherrystudio/agent-runtime'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable, type AgentRuntimeLocator } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import {
  type AgentSessionMessageRow,
  agentSessionMessagePartTable as sessionMessagePartsTable,
  agentSessionMessageTable as sessionMessagesTable,
  agentSessionToolOutputTable as sessionToolOutputsTable,
  type InsertAgentSessionMessageRow as InsertSessionMessageRow
} from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { resolveAgentSessionRunHistory, type RunEditPlan } from '@data/services/agentSessionRunHistory'
import { agentSessionReadModelEffects, agentSessionService } from '@data/services/AgentSessionService'
import { registerDataService } from '@data/services/dataServiceRegistry'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { Emitter } from '@main/core/lifecycle'
import { orderAgentTimelineParts } from '@main/utils/agentTimelineOrder'
import { projectMessagePartForRenderer, projectMessagePartsForRenderer } from '@main/utils/messageOutputProjection'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
import {
  extractFtsTokens,
  extractMatchTerms,
  extractShortTerms,
  needsLikeFallback,
  toFtsLikePattern,
  toFtsMatchQuery
} from '@main/utils/trigramFtsQuery'
import { AgentSessionCostSnapshotSchema, type AgentSessionCostSnapshot } from '@shared/ai/agentSessionCost'
import {
  AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES,
  type AgentSessionDeliveryEnvelope,
  type AgentSessionDeliveryError,
  type AgentSessionDeliveryOutcome,
  type AgentSessionDeliveryReplyPolicy,
  type AgentSessionDeliveryStatus
} from '@shared/ai/agentSessionDelivery'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import type { LocalAgentTurnUsage } from '@shared/ai/localAgentUsage'
import { NativeInteractionInputSchema } from '@shared/ai/nativeInteraction'
import { getSafeProviderErrorMessage } from '@shared/ai/providerError'
import {
  applyApprovalDecisions,
  type ApprovalDecision,
  isDeferredToolOutput,
  toolResultValue,
  isPersistedToolOutput
} from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  AgentSessionMessageEntity,
  AgentSessionMessageReadQuery,
  CreateAgentSessionMessageDto,
  CreateAgentSessionMessagesDto,
  UpdateAgentSessionMessageDto
} from '@shared/data/api/schemas/agentSessionMessages'
import {
  AGENT_SESSION_MESSAGES_DEFAULT_LIMIT,
  AGENT_SESSION_MESSAGES_MAX_LIMIT
} from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { SessionMessageContentSearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { MessageProvenance } from '@shared/data/types/conversationImport'
import {
  AGENT_SESSION_MESSAGE_SEARCH_ROLES,
  type CherryUIMessage,
  type MessageStatus,
  type CherryMessagePart,
  coerceSearchRole,
  type MessageRuntimeStatsInput
} from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { agentSessionContextService, type RootProjectionCheckpoint } from './AgentSessionContextService'
import { AgentSessionEditError } from './AgentSessionEditError'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor, type RuntimeForkCheckpoint } from './agentSessionForkContract'
import { sessionMessageOrdering } from './agentSessionMessageOrder'
import {
  advanceAgentSessionHeadTx,
  advanceAgentSessionPositionTx,
  agentSessionDescendantIds,
  type AgentSessionMessageData,
  type AgentSessionMessageRecord,
  agentSessionPathIds,
  readStoredAgentSessionPath,
  attachAgentSessionMessagePartsTx,
  ensureAgentSessionRootTx,
  getAgentSessionHead,
  hydrateAgentSessionMessageDataTx,
  hydrateAgentSessionMessageRowsTx,
  orderAgentSessionPath,
  readAgentSessionAncestry,
  readAgentSessionMessagePartIdsTx,
  readAgentSessionPath,
  replaceAgentSessionMessagePartsTx,
  splitAgentSessionMessageData,
  validateAgentSessionParent,
  writeAgentSessionMessagePartsTx
} from './agentSessionMessageTree'
import { aiUsageRecordService, mergeMessageRuntimeStats } from './AiUsageRecordService'
import { presentCodexHistory } from './importedCodexText'
import { presentClaudeHistory, presentImportedTools } from './importedHistoryText'
import {
  messageProvenanceSql,
  setMessageProvenanceTx,
  deleteMessageProvenanceTx,
  refreshImportedHistoryMessageCountTx
} from './importedSessionHistory'
import { isAssistantActivityTransition, isConversationActivityRole } from './utils/activityTime'
import { type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

export type ExpectedAgent = string | { id: string; updatedAt: string; model: string | null; type: string }

type SessionMessageRow = AgentSessionMessageRow & { provenance?: MessageProvenance | null }

const logger = loggerService.withContext('AgentSessionMessageService')

type SessionMessage = AgentSessionMessageRecord & { provenance?: MessageProvenance | null }
const SQLITE_INARRAY_CHUNK = 500
// A ranked tool search runs synchronously on Main. Cap evidence scanning at 20 pages per requested
// result; raise this only if relevance telemetry shows valid Sessions routinely beyond the ceiling.
const RANKED_SESSION_SEARCH_SCAN_MULTIPLIER = 20
// SQLite's default expression-depth ceiling is 1,000. Keep pure-LIKE fallback comfortably below it.
const RANKED_SESSION_SEARCH_MAX_FALLBACK_TERMS = 128
const MESSAGE_CURSOR_CONFIG = {
  fieldMessage: 'must be a valid message cursor',
  errorMessage: 'Invalid message cursor'
}

export interface AgentSessionMessageRangeMetadata {
  readonly createdAt: string
  readonly entityJsonBytes: number
  readonly id: string
  readonly sessionId: string
}

function canRepairAfterCrash(nativeKinds: readonly AgentRuntimeLocator['kind'][] = []): SQL {
  const resumeToken = sql`coalesce(json_extract(${sessionMessagesTable.data}, '$.nativeSessionId'), ${sessionMessagesTable.runtimeResumeToken})`
  const retainedKinds = nativeKinds.length
    ? sql`AND json_extract(backend.locator, '$.kind') NOT IN (${sql.join(
        nativeKinds.map((kind) => sql`${kind}`),
        sql`, `
      )})`
    : sql``
  return sql`NOT EXISTS (
    WITH RECURSIVE linked(context_id) AS (
      SELECT u.input_context_id FROM agent_session_message AS u
      WHERE u.session_id = ${sessionMessagesTable.sessionId} AND u.reply_id = ${sessionMessagesTable.id}
        AND u.input_context_id IS NOT NULL
    ), input_path(id, parent_id, role, context_id) AS (
      SELECT ${sessionMessagesTable.id}, ${sessionMessagesTable.parentId}, ${sessionMessagesTable.role}, ${sessionMessagesTable.inputContextId}
      WHERE ${resumeToken} IS NULL AND NOT EXISTS (SELECT 1 FROM linked)
      UNION
      SELECT p.id, p.parent_id, p.role, p.input_context_id FROM input_path JOIN agent_session_message AS p ON p.id = input_path.parent_id
      WHERE input_path.role != 'user' AND p.session_id = ${sessionMessagesTable.sessionId}
    ), owners(context_id) AS (
      SELECT context_id FROM linked
      UNION ALL SELECT context_id FROM input_path WHERE context_id IS NOT NULL
      UNION ALL SELECT c.id FROM agent_session_context AS c
        WHERE c.session_id = ${sessionMessagesTable.sessionId} AND c.native_thread_id = ${resumeToken}
          AND NOT EXISTS (SELECT 1 FROM linked)
          AND EXISTS (SELECT 1 FROM agent_session_message WHERE session_id = c.session_id AND input_context_id = c.id)
    )
    SELECT 1 FROM owners JOIN agent_session_context AS c ON c.id = owners.context_id
      JOIN agent_runtime_backend AS backend ON backend.id = c.backend_id
      WHERE c.session_id = ${sessionMessagesTable.sessionId} ${retainedKinds}
  )`
}

function storedToolOutput(partId?: string): SQL {
  const p = sessionMessagePartsTable
  const t = sessionToolOutputsTable
  const owner = and(eq(p.messageId, t.messageId), partId ? eq(p.id, partId) : undefined)
  return sql`case when exists (
    select 1 from ${p} where ${owner}
      and json_extract(${p.payload}, '$.toolCallId') = ${t.toolCallId}
      and json_extract(${p.payload}, '$.output.archivedProviderMetadata')
  ) then ${t.output} -> '$.output' else ${t.output} end`
}

function agentSessionMessageEntityJsonBytes(): SQL<number> {
  return sql<number>`length(cast(json_object(
    'id', ${sessionMessagesTable.id},
    'sessionId', ${sessionMessagesTable.sessionId},
    'role', ${sessionMessagesTable.role},
    'data', json_set(
      json_remove(json(${sessionMessagesTable.data}), '$.runtimeAnchor', '$.nativeSessionId', '$.deliveryReplyAnchor', '$.locallyHandled', '$.nativePlaced'),
      '$.parts',
      json((
        select json_group_array(json(ordered.payload)) from (
          select payload from agent_session_message_part
          where message_id = ${sessionMessagesTable.id} order by seq
        ) as ordered
      ))
    ),
    'searchableText', ${sessionMessagesTable.searchableText},
    'status', ${sessionMessagesTable.status},
    'modelId', ${sessionMessagesTable.modelId},
    'messageSnapshot', json(${sessionMessagesTable.messageSnapshot}),
    'stats', json(${sessionMessagesTable.stats}),
    'runtimeResumeToken', ${sessionMessagesTable.runtimeResumeToken},
    'pos', ${sessionMessagesTable.pos},
    'replyId', ${sessionMessagesTable.replyId},
    'delivery', json(case
      when ${sessionMessagesTable.delivery} is not null and ${sessionMessagesTable.deliveryStatus} is not null
      then json_set(
        json(${sessionMessagesTable.delivery}),
        '$.status', ${sessionMessagesTable.deliveryStatus},
        '$.inReplyTo', ${sessionMessagesTable.deliveryInReplyTo},
        '$.turnRef', ${sessionMessagesTable.deliveryTurnRef}
      )
      else null
    end),
    'createdAt', strftime('%Y-%m-%dT%H:%M:%fZ', ${sessionMessagesTable.createdAt} / 1000.0, 'unixepoch'),
    'updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', ${sessionMessagesTable.updatedAt} / 1000.0, 'unixepoch')
  ) as blob)) + coalesce((
    select sum(
      case json_extract(part.payload, '$.state')
        when 'output-available' then case
          when json_extract(part.payload, '$.output.archivedProviderMetadata') then
            length(cast(json_set(part.payload, '$.output', t.output -> '$.output',
              '$.resultProviderMetadata', t.output -> '$.resultProviderMetadata') as blob)) - length(cast(json(part.payload) as blob))
          else length(cast(json(t.output) as blob)) - length(cast(json_extract(part.payload, '$.output') as blob))
        end
        when 'output-error' then
          length(cast(case
            when json_type(t.output, '$.resultProviderMetadata') is null then
              json_set(json_remove(part.payload, '$.resultProviderMetadata'), '$.errorText', json_extract(t.output, '$.content[0].text'))
            else json_set(part.payload, '$.errorText', json_extract(t.output, '$.content[0].text'),
              '$.resultProviderMetadata', json_extract(t.output, '$.resultProviderMetadata'))
          end as blob)) - length(cast(json(part.payload) as blob))
      end
    )
    from agent_session_tool_output as t
    join agent_session_message_part as part on part.message_id = t.message_id
    where t.message_id = ${sessionMessagesTable.id}
      and json_extract(part.payload, '$.toolCallId') = t.tool_call_id
  ), 0)`
}

type SessionMessageSearchRow = {
  rowId: string
  sessionId: string
  sessionName: string
  agentId: string | null
  agentName: string | null
  role: string
  searchableText: string
  createdAt: number
}

type SessionMessageContentSearchInput = {
  q: string
  cursor?: string
  limit?: number
  createdAtFrom?: string
  sessionId?: string
}

type RankedSessionMessageSearchInput = {
  q: string
  limit?: number
  agentId?: string
  addressableOnly?: boolean
}

type ListSessionMessagesOptions = {
  cursor?: string
  limit?: number
  messageId?: string
  deferToolOutputs?: boolean
}

type SaveAgentSessionMessageParams = {
  sessionId: string
  parentId?: string
  stageFollowup?: true
  deliveryReplyAnchor?: string
  runtimeAnchor?: unknown
  runtimeResumeToken?: string
  runtimeStats?: MessageRuntimeStatsInput
  unchangedToolCallIds?: ReadonlySet<string>
  localSessionCost?: AgentSessionCostSnapshot
  localTurnUsage?: LocalAgentTurnUsage
  nativeContextId?: string
  /** Stored part identities parallel to `message.data.parts`; unchanged parts are not rewritten. */
  partIds?: readonly string[]
  positions?: ReadonlyMap<string, number>
  message: CreateAgentSessionMessageDto & {
    delivery?: AgentSessionDeliveryEnvelope
    deliveryStatus?: AgentSessionDeliveryStatus
    deliveryTurnRef?: string | null
    deliveryInReplyTo?: string | null
    deliverySenderSessionId?: string | null
  }
}

function mapSessionMessageSearchRow(row: SessionMessageSearchRow, snippet: string): SessionMessageContentSearchItem {
  return {
    messageId: row.rowId,
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    role: coerceSearchRole(row.role, AGENT_SESSION_MESSAGE_SEARCH_ROLES),
    snippet,
    createdAt: timestampToISO(Number(row.createdAt))
  }
}

export const AGENT_SESSION_DELIVERY_ERROR_CODES = {
  SENDER_FORBIDDEN: 'SENDER_FORBIDDEN',
  SESSION_TOOL_FORBIDDEN: 'SESSION_TOOL_FORBIDDEN',
  TARGET_AGENT_DELETED: 'TARGET_AGENT_DELETED',
  TARGET_SESSION_NOT_FOUND: 'TARGET_SESSION_NOT_FOUND',
  TARGET_SESSION_ORPHANED: 'TARGET_SESSION_ORPHANED',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TURN_START_INTERRUPTED: 'TURN_START_INTERRUPTED',
  DELIVERY_TURN_DELETED: 'DELIVERY_TURN_DELETED',
  CANCELLED: 'CANCELLED',
  TARGET_SESSION_DELETED: 'TARGET_SESSION_DELETED',
  CALLER_SESSION_DELETED: 'CALLER_SESSION_DELETED'
} as const

export type AgentSessionDeliveryErrorCode =
  (typeof AGENT_SESSION_DELIVERY_ERROR_CODES)[keyof typeof AGENT_SESSION_DELIVERY_ERROR_CODES]

export class AgentSessionDeliveryRoutingError extends Error {
  constructor(
    readonly code: AgentSessionDeliveryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentSessionDeliveryRoutingError'
  }
}

type SaveAgentSessionMessageOptions = {
  projection?: RootProjectionCheckpoint
} & ({ db: DbOrTx; publishDataChange?: never } | { db?: undefined; publishDataChange?: boolean })

type SavedAgentSessionMessage = {
  entity: AgentSessionMessageEntity
  dataChange: 'membership' | 'projection'
  activityTimestamp: number | null
}

function replaceAgentSessionMessageFileRefsTx(
  tx: DbOrTx,
  messageId: string,
  data: AgentSessionMessageEntity['data']
): void {
  tx.delete(agentSessionMessageFileRefTable).where(eq(agentSessionMessageFileRefTable.sourceId, messageId)).run()

  const snapshot = tx
    .select({ snapshot: sessionMessagesTable.messageSnapshot })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.id, messageId))
    .get()?.snapshot
  const ids = [
    ...new Set(
      (data.parts ?? [])
        .filter((part) => part.type === 'file')
        .flatMap((part) => [readCherryMeta(part)?.fileEntryId, readCherryMeta(part)?.workingFileEntryId])
        .filter((id): id is string => Boolean(id))
    )
  ]
  const attachmentIds = new Set(ids)
  if (snapshot?.avatarFileId && !ids.includes(snapshot.avatarFileId)) ids.push(snapshot.avatarFileId)
  if (ids.length === 0) return

  const existingIds = new Set<string>()
  for (let index = 0; index < ids.length; index += SQLITE_INARRAY_CHUNK) {
    const rows = tx
      .select({ id: fileEntryTable.id })
      .from(fileEntryTable)
      .where(inArray(fileEntryTable.id, ids.slice(index, index + SQLITE_INARRAY_CHUNK)))
      .all()
    rows.forEach((row) => existingIds.add(row.id))
  }

  const now = Date.now()
  const rows = ids
    .filter((fileEntryId) => existingIds.has(fileEntryId))
    .flatMap((fileEntryId) => [
      ...(attachmentIds.has(fileEntryId)
        ? [{ fileEntryId, sourceId: messageId, role: 'attachment' as const, createdAt: now, updatedAt: now }]
        : []),
      ...(fileEntryId === snapshot?.avatarFileId
        ? [{ fileEntryId, sourceId: messageId, role: 'author_avatar' as const, createdAt: now, updatedAt: now }]
        : [])
    ])

  if (existingIds.size !== ids.length) {
    logger.warn('Dropped agent-session message file refs without matching file_entry', {
      messageId,
      dropped: ids.length - existingIds.size,
      total: ids.length
    })
  }

  for (let index = 0; index < rows.length; index += SQLITE_INARRAY_CHUNK) {
    tx.insert(agentSessionMessageFileRefTable)
      .values(rows.slice(index, index + SQLITE_INARRAY_CHUNK))
      .run()
  }
}

function terminalResultData(
  message: SessionMessage | null,
  outcome: AgentSessionDeliveryOutcome,
  error?: AgentSessionDeliveryError | null
): AgentSessionMessageEntity['data'] {
  const parts = (message?.data.parts ?? []).flatMap((part): CherryMessagePart[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }]
    // oxlint-disable-next-line no-restricted-globals -- Fork once: detach this file part and nested metadata before the destination owns it.
    if (part.type === 'file' && readCherryMeta(part)?.fileEntryId) return [structuredClone(part)]
    return []
  })
  if (error?.message) parts.push({ type: 'text', text: error.message })
  if (parts.length > 0) return { parts }

  const text =
    error?.message ??
    (outcome === 'success'
      ? 'Session completed without a text response.'
      : outcome === 'interrupted'
        ? 'Session was interrupted before producing a result.'
        : 'Session failed without a text response.')
  return { parts: [{ type: 'text', text }] }
}

function publicMessageData(data: AgentSessionMessageData): AgentSessionMessageEntity['data'] {
  const result = { ...data }
  delete result.runtimeAnchor
  delete result.nativeSessionId
  delete result.deliveryReplyAnchor
  delete result.nativePlaced
  delete result.locallyHandled
  delete result.stagedFollowup
  return result
}

type OffloadedToolOutput = {
  toolCallId: string
  serialized: string
}

type AcceptedToolPart = { messageId: string; projected: CherryMessagePart; serialized: string }

function extractMessageToolOutputs<T extends AgentSessionMessageData>(
  sessionId: string,
  messageId: string,
  data: T,
  acceptedParts: WeakMap<object, AcceptedToolPart>,
  unchangedToolCallIds?: ReadonlySet<string>
): {
  storedData: T
  offloaded: OffloadedToolOutput[]
  retainedToolCallIds: Set<string>
  hasDeferredInput: boolean
} {
  const parts = data.parts
  const retainedToolCallIds = new Set<string>()
  const offloaded: OffloadedToolOutput[] = []
  let hasDeferredInput = false
  if (!parts?.length) return { storedData: data, offloaded, retainedToolCallIds, hasDeferredInput }

  const topicId = `agent-session:${sessionId}`
  let storedParts: typeof parts | undefined
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!isToolUIPart(part) || (part.state !== 'output-available' && part.state !== 'output-error')) continue
    const body = toolResultValue(part)
    if (isDeferredToolOutput(body)) {
      retainedToolCallIds.add(part.toolCallId)
      hasDeferredInput = true
      continue
    }
    if (isPersistedToolOutput(body) && !part.resultProviderMetadata) continue
    const cached = isAcceptedToolPart(part) ? acceptedParts.get(part) : undefined
    let serialized = cached?.messageId === messageId ? cached.serialized : (JSON.stringify(body) ?? 'null')
    const projected =
      cached?.messageId === messageId
        ? cached.projected
        : projectMessagePartForRenderer(part, topicId, messageId, serialized)
    if (
      projected === part ||
      !isToolUIPart(projected) ||
      (projected.state !== 'output-available' && projected.state !== 'output-error') ||
      !isDeferredToolOutput(toolResultValue(projected))
    )
      continue
    if (
      isPersistedToolOutput(body) &&
      !(
        projected.state === 'output-available' &&
        isDeferredToolOutput(projected.output) &&
        projected.output.archivedProviderMetadata
      )
    )
      continue
    retainedToolCallIds.add(part.toolCallId)
    if (
      cached?.messageId !== messageId &&
      projected.state === 'output-available' &&
      isDeferredToolOutput(projected.output) &&
      projected.output.archivedProviderMetadata
    ) {
      serialized = JSON.stringify({ output: body ?? null, resultProviderMetadata: part.resultProviderMetadata })
    }
    if (isAcceptedToolPart(part)) acceptedParts.set(part, { messageId, projected, serialized })
    if (!isAcceptedToolPart(part) || !unchangedToolCallIds?.has(part.toolCallId))
      offloaded.push({
        toolCallId: part.toolCallId,
        serialized
      })
    storedParts ??= [...parts]
    storedParts[index] = projected
  }

  return {
    storedData: storedParts ? { ...data, parts: storedParts } : data,
    offloaded,
    retainedToolCallIds,
    hasDeferredInput
  }
}

function collectDeferredToolCallIds(data: AgentSessionMessageData): Set<string> {
  const toolCallIds = new Set<string>()
  for (const part of data.parts ?? []) {
    if (
      !isToolUIPart(part) ||
      (part.state !== 'output-available' && part.state !== 'output-error') ||
      !isDeferredToolOutput(toolResultValue(part))
    )
      continue
    toolCallIds.add(part.toolCallId)
  }
  return toolCallIds
}

function syncMessageToolOutputsTx(
  tx: DbOrTx,
  sessionId: string,
  messageId: string,
  offloaded: readonly OffloadedToolOutput[],
  retainedToolCallIds: ReadonlySet<string>,
  existingData: AgentSessionMessageData | undefined,
  timestampMs: number
): void {
  const previousToolCallIds = existingData ? collectDeferredToolCallIds(existingData) : undefined
  for (const item of offloaded) {
    tx.insert(sessionToolOutputsTable)
      .values({
        messageId,
        toolCallId: item.toolCallId,
        sessionId,
        output: sql`${item.serialized}`,
        createdAt: timestampMs,
        updatedAt: timestampMs
      })
      .onConflictDoUpdate({
        target: [sessionToolOutputsTable.messageId, sessionToolOutputsTable.toolCallId],
        set: {
          sessionId,
          output: sql`excluded.output`,
          updatedAt: timestampMs
        },
        setWhere: sql`${sessionToolOutputsTable.output} IS NOT excluded.output`
      })
      .run()
  }

  if (!previousToolCallIds) return
  const staleIds = [...previousToolCallIds].filter((toolCallId) => !retainedToolCallIds.has(toolCallId))
  for (let index = 0; index < staleIds.length; index += SQLITE_INARRAY_CHUNK) {
    tx.delete(sessionToolOutputsTable)
      .where(
        and(
          eq(sessionToolOutputsTable.messageId, messageId),
          inArray(sessionToolOutputsTable.toolCallId, staleIds.slice(index, index + SQLITE_INARRAY_CHUNK))
        )
      )
      .run()
  }
}

const editVersion: unique symbol = Symbol('agent-session-edit-version')

export class AgentSessionMessageService {
  private readonly branchSelected = new Emitter<{ sessionId: string; head: string }>()
  readonly onBranchSelected = this.branchSelected.event

  private readonly acceptedToolParts = new WeakMap<object, AcceptedToolPart>()

  private extractMessageToolOutputs<T extends AgentSessionMessageData>(
    sessionId: string,
    messageId: string,
    data: T,
    unchangedToolCallIds?: ReadonlySet<string>
  ) {
    return extractMessageToolOutputs(sessionId, messageId, data, this.acceptedToolParts, unchangedToolCallIds)
  }

  saveRunCheckpoint(sessionId: string, runId: string, anchor: RuntimeForkAnchor): void {
    const value = JSON.stringify(RuntimeForkAnchorSchema.parse(anchor))
    const result = application
      .get('DbService')
      .getDb()
      .update(sessionMessagesTable)
      .set({
        data: sql`json_set(${sessionMessagesTable.data}, '$.runtimeAnchor', json(${value}))`
      })
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.id, runId),
          eq(sessionMessagesTable.role, 'assistant'),
          eq(sessionMessagesTable.status, 'success'),
          sql`coalesce(json_extract(${sessionMessagesTable.data}, '$.runtimeAnchor'), '') <> ${value}`
        )
      )
      .run()
    if (result.changes)
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds: [runId]
        }
      ])
  }

  readWorkspaceRelocationHistory(workspaceId: string) {
    return application
      .get('DbService')
      .getDb()
      .select({
        messageId: sessionMessagesTable.id,
        sessionId: sessionTable.id,
        runtime: agentTable.type,
        role: sessionMessagesTable.role,
        status: sessionMessagesTable.status,
        userText: sql<
          string | null
        >`case when ${sessionMessagesTable.role} = 'user' then ${sessionMessagesTable.searchableText} end`,
        nativeSessionId: sql<string | null>`json_extract(${sessionMessagesTable.data}, '$.nativeSessionId')`,
        resumeToken: sessionMessagesTable.runtimeResumeToken,
        checkpoint: sql<string | null>`json_extract(${sessionMessagesTable.data}, '$.runtimeAnchor.checkpoint')`
      })
      .from(sessionTable)
      .leftJoin(
        sessionMessagesTable,
        and(eq(sessionTable.id, sessionMessagesTable.sessionId), ne(sessionMessagesTable.role, 'root'))
      )
      .leftJoin(agentTable, eq(agentTable.id, sessionTable.agentId))
      .where(eq(sessionTable.workspaceId, workspaceId))
      .all()
  }

  relocateCheckpointsTx(
    tx: DbOrTx,
    workspaceId: string,
    checkpoints: readonly { messageId: string; checkpoint: RuntimeForkCheckpoint }[]
  ): void {
    for (const { messageId, checkpoint } of checkpoints) {
      const result = tx
        .update(sessionMessagesTable)
        .set({
          data: sql`json_set(${sessionMessagesTable.data}, '$.runtimeAnchor.checkpoint', json(${JSON.stringify(checkpoint)}))`,
          updatedAt: sessionMessagesTable.updatedAt
        })
        .where(
          and(
            eq(sessionMessagesTable.id, messageId),
            inArray(
              sessionMessagesTable.sessionId,
              tx.select({ id: sessionTable.id }).from(sessionTable).where(eq(sessionTable.workspaceId, workspaceId))
            )
          )
        )
        .run()
      if (result.changes !== 1) throw new Error('Session message changed during relocation')
    }
  }

  hasContextInput(sessionId: string, contextId: string): boolean {
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.inputContextId, contextId)))
        .limit(1)
        .get()
    )
  }

  /** Records the reply Main opened for each input; a regenerated reply replaces the previous one. */
  linkReply(sessionId: string, inputIds: readonly string[], replyId: string): void {
    if (!inputIds.length) return
    const changed = application
      .get('DbService')
      .getDb()
      .update(sessionMessagesTable)
      .set({ replyId })
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          inArray(sessionMessagesTable.id, [...inputIds]),
          eq(sessionMessagesTable.role, 'user'),
          or(isNull(sessionMessagesTable.replyId), ne(sessionMessagesTable.replyId, replyId))
        )
      )
      .returning({ id: sessionMessagesTable.id })
      .all()
    if (changed.length)
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds: changed.map(({ id }) => id)
        }
      ])
  }

  /**
   * The reply Main opened for an input. An input saved before replies were linked falls back to its
   * latest direct reply that no other input claims.
   */
  replyTo(sessionId: string, inputId: string): { id: string; status: string } | undefined {
    const db = application.get('DbService').getDb()
    const reply = { id: sessionMessagesTable.id, status: sessionMessagesTable.status }
    const input = db
      .select({ replyId: sessionMessagesTable.replyId })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, inputId)))
      .get()
    if (input?.replyId)
      return db
        .select(reply)
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, input.replyId)))
        .get()
    const claimed = db
      .select({ id: sessionMessagesTable.replyId })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), isNotNull(sessionMessagesTable.replyId)))
    return db
      .select(reply)
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.parentId, inputId),
          eq(sessionMessagesTable.role, 'assistant'),
          notInArray(sessionMessagesTable.id, claimed)
        )
      )
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .get()
  }

  hasContextModelInput(sessionId: string, contextId: string): boolean {
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.inputContextId, contextId),
            sql`coalesce(json_extract(${sessionMessagesTable.data}, '$.locallyHandled'), 0) = 0`
          )
        )
        .limit(1)
        .get()
    )
  }

  markInputLocallyHandledTx(tx: DbOrTx, sessionId: string, messageId: string, contextId: string): void {
    tx.update(sessionMessagesTable)
      .set({ data: sql`json_set(${sessionMessagesTable.data}, '$.locallyHandled', json('true'))` })
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.inputContextId, contextId),
          sql`coalesce(json_extract(${sessionMessagesTable.data}, '$.locallyHandled'), 0) = 0`
        )
      )
      .run()
  }

  inputBinding(sessionId: string, messageId: string) {
    return application
      .get('DbService')
      .getDb()
      .select({ contextId: sessionMessagesTable.inputContextId, nativeInputId: sessionMessagesTable.nativeInputId })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.role, 'user'),
          isNotNull(sessionMessagesTable.inputContextId)
        )
      )
      .get()
  }

  inputTarget(sessionId: string, inputId: string) {
    return application
      .get('DbService')
      .getDb()
      .select({
        contextId: agentSessionContextTable.id,
        anchor: agentSessionContextTable.anchorMessageId,
        backendId: agentSessionContextTable.backendId,
        threadId: agentSessionContextTable.nativeThreadId,
        kind: sql<string>`json_extract(${agentRuntimeBackendTable.locator}, '$.kind')`,
        nativeInputId: sessionMessagesTable.nativeInputId,
        locallyHandled: sql<number>`coalesce(json_extract(${sessionMessagesTable.data}, '$.locallyHandled'), 0)`
      })
      .from(sessionMessagesTable)
      .innerJoin(
        agentSessionContextTable,
        and(
          eq(agentSessionContextTable.id, sessionMessagesTable.inputContextId),
          eq(agentSessionContextTable.sessionId, sessionMessagesTable.sessionId)
        )
      )
      .innerJoin(agentRuntimeBackendTable, eq(agentRuntimeBackendTable.id, agentSessionContextTable.backendId))
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.id, inputId),
          eq(sessionMessagesTable.role, 'user')
        )
      )
      .get()
  }

  /** The original bindings of all inputs that can still write a pending Run. */
  pendingReplyInputs(scope: { sessionId?: string; contextId?: string; runId?: string; durableOnly?: boolean } = {}) {
    return application.get('DbService').getDb().all<{
      sessionId: string
      contextId: string
      runId: string
      inputId: string
      backendId: string
      threadId: string | null
      nativeInputId: string | null
    }>(sql`
      WITH pending AS MATERIALIZED (
        SELECT id, session_id, parent_id FROM agent_session_message
        WHERE role = 'assistant' AND status = 'pending'
        ${scope.sessionId ? sql`AND session_id = ${scope.sessionId}` : sql``}
        ${scope.runId ? sql`AND id = ${scope.runId}` : sql``}
      ), inputs AS (
        SELECT r.id AS run_id, u.id FROM pending r CROSS JOIN agent_session_message u
          ON u.session_id = r.session_id AND u.reply_id = r.id
        WHERE u.role = 'user'
        UNION ALL
        SELECT r.id, u.id FROM pending r CROSS JOIN agent_session_message u ON u.id = r.parent_id
        WHERE u.session_id = r.session_id AND u.role = 'user' AND u.reply_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM agent_session_message linked WHERE linked.session_id = r.session_id AND linked.reply_id = r.id)
          AND NOT EXISTS (
            SELECT 1 FROM agent_session_message sibling
            WHERE sibling.session_id = r.session_id AND sibling.parent_id = u.id
              AND sibling.role = 'assistant' AND sibling.id != r.id
              AND NOT EXISTS (
                SELECT 1 FROM agent_session_message owner
                WHERE owner.session_id = r.session_id AND owner.reply_id = sibling.id
              )
          )
      )
      SELECT u.session_id AS sessionId, c.id AS contextId, inputs.run_id AS runId, u.id AS inputId,
             c.backend_id AS backendId, c.native_thread_id AS threadId, u.native_input_id AS nativeInputId
      FROM inputs CROSS JOIN agent_session_message u ON u.id = inputs.id
      JOIN agent_session_context c ON c.id = u.input_context_id AND c.session_id = u.session_id
      JOIN agent_runtime_backend b ON b.id = c.backend_id
      JOIN agent_session s ON s.id = u.session_id AND s.deleted_at IS NULL
      WHERE coalesce(json_extract(u.data, '$.locallyHandled'), 0) = 0
        AND NOT EXISTS (SELECT 1 FROM agent_session_message unbound WHERE unbound.session_id = u.session_id
          AND unbound.reply_id = inputs.run_id AND unbound.role = 'user' AND unbound.input_context_id IS NULL
          AND coalesce(json_extract(unbound.data, '$.locallyHandled'), 0) = 0)
        ${scope.contextId ? sql`AND c.id = ${scope.contextId}` : sql``}
        ${scope.durableOnly ? sql`AND json_extract(b.locator, '$.kind') = 'pi-durable'` : sql``}
    `)
  }

  /** Recheck the Run and its inputs under the same write lock that commits its completed body. */
  settleRecoveredReply(
    target: {
      sessionId: string
      runId: string
      contextId: string
      inputIds: readonly string[]
      placedInputIds: readonly string[]
      timeline?: { lastPos: number }
      forkAnchor?: RuntimeForkAnchor
    },
    status: 'success' | 'paused' | 'error',
    sources: readonly { id: string; parts: CherryMessagePart[] }[],
    errorPart?: CherryMessagePart
  ): boolean {
    const { sessionId, runId, contextId, inputIds } = target
    const result = application.get('DbService').withWriteTx((tx) => {
      const current = this.pendingReplyInputs({ sessionId, runId })
      const ids = new Set(inputIds)
      if (current.length !== ids.size || current.some((row) => row.contextId !== contextId || !ids.has(row.inputId)))
        return
      const placed = target.placedInputIds.filter((id) => ids.has(id))
      if (placed.length)
        tx.update(sessionMessagesTable)
          .set({ data: sql`json_set(${sessionMessagesTable.data}, '$.nativePlaced', json('true'))` })
          .where(and(eq(sessionMessagesTable.sessionId, sessionId), inArray(sessionMessagesTable.id, placed)))
          .run()
      const context = agentSessionContextService.context(contextId)
      const checkpoint = context.checkpointMapping?.root
      const removed = new Set(checkpoint?.removed)
      if (
        sources.some(
          ({ id }) => removed.has(id) || (checkpoint?.sources[id] && checkpoint.sources[id].messageId !== runId)
        )
      )
        return
      const stored = this.getStoredMessageParts(sessionId, runId)
      const retained = new Set<string>()
      const entries: { partId: string; pos: number | null; payload: CherryMessagePart }[] = []
      const positions = new Map<string, number>()
      let lastPos = Math.max(this.lastTimelinePosition(sessionId), target.timeline?.lastPos ?? 0)
      const ranges = { ...checkpoint?.sources }
      const hasSourceMapping = Object.values(ranges).some((range) => range.messageId === runId)
      const storedById = new Map(stored.map((part) => [part.partId, part]))
      const knownTools = new Map(
        stored.flatMap((entry) => (isToolUIPart(entry.payload) ? [[entry.payload.toolCallId, entry] as const] : []))
      )
      const admit = (payload: CherryMessagePart) => {
        const partId = uuidv7()
        positions.set(partId, ++lastPos)
        entries.push({ partId, pos: lastPos, payload })
        return partId
      }
      for (const source of sources) {
        const offset = entries.length
        const previous = ranges[source.id]
        const previousParts =
          previous &&
          ('partIds' in previous
            ? previous.partIds.map((id) => storedById.get(id))
            : stored.slice(previous.offset, previous.offset + previous.count))
        const partIds: string[] = []
        for (const [index, part] of source.parts.entries()) {
          const before = isToolUIPart(part)
            ? knownTools.get(part.toolCallId)
            : hasSourceMapping
              ? previousParts?.[index]
              : stored[offset + index]
          if (before && before.payload.type === part.type && !retained.has(before.partId)) {
            retained.add(before.partId)
            partIds.push(before.partId)
            entries.push({ partId: before.partId, pos: before.pos ?? null, payload: part })
          } else partIds.push(admit(part))
        }
        ranges[source.id] = { messageId: runId, partIds }
      }
      const hasNativeParts = entries.length > 0
      for (const entry of stored) {
        if (retained.has(entry.partId)) continue
        if (hasNativeParts && !isDataUIPart(entry.payload)) return
        entries.push({ ...entry, pos: entry.pos ?? null })
      }
      if (errorPart && !entries.some(({ payload }) => payload.type === 'data-error')) admit(errorPart)
      const ordered = orderAgentTimelineParts(entries, () => stored)
      const saved = this.saveMessageTx(tx, {
        sessionId,
        ...(status === 'success' &&
          target.forkAnchor && {
            runtimeAnchor: target.forkAnchor,
            runtimeResumeToken: context.nativeThreadId ?? undefined
          }),
        partIds: ordered.map(({ partId }) => partId),
        positions,
        message: {
          id: runId,
          role: 'assistant',
          status,
          data: { ...this.getSessionMessage(sessionId, runId).data, parts: ordered.map(({ payload }) => payload) }
        }
      })
      if (sources.length) {
        const incoming = new Set(sources.map((source) => source.id))
        for (const [id, range] of Object.entries(ranges)) {
          if (range.messageId === runId && !incoming.has(id)) {
            delete ranges[id]
            removed.add(id)
          }
        }
        agentSessionContextService.saveRootProjectionTx(tx, sessionId, {
          contextId,
          root: { version: 3, sources: ranges, removed: [...removed] }
        })
      }
      return { saved, lastPos }
    })
    if (!result) return false
    if (target.timeline) target.timeline.lastPos = result.lastPos
    this.publishSavedMessage(sessionId, result.saved, true)
    return true
  }

  readChildMessages(sessionId: string): CherryUIMessage[] {
    const db = application.get('DbService').getDb()
    return readStoredAgentSessionPath(db, sessionId).map((row) => ({
      id: row.id,
      role: row.role as CherryUIMessage['role'],
      metadata: { status: row.status as MessageStatus },
      parts: row.data.parts,
      partIds: readAgentSessionMessagePartIdsTx(db, row.id)
    }))
  }

  readChildPage(sessionId: string, cursor?: string) {
    const db = application.get('DbService').getDb()
    const head = cursor ?? getAgentSessionHead(db, sessionId)
    const items: CherryUIMessage[] = []
    if (!head) return { items }
    const path = db.all<{
      id: string
      parent_id: string | null
      role: CherryUIMessage['role']
      status: MessageStatus
    }>(sql`
      WITH RECURSIVE page(id,parent_id,role,status,n) AS (
        SELECT id,parent_id,role,status,1 FROM agent_session_message WHERE session_id=${sessionId} AND id=${head} AND role!='root'
        UNION ALL SELECT m.id,m.parent_id,m.role,m.status,p.n+1 FROM page p JOIN agent_session_message m ON m.id=p.parent_id
        WHERE m.session_id=${sessionId} AND m.role!='root' AND (p.n<50 OR p.role!='user')
      ) SELECT id,parent_id,role,status FROM page ORDER BY n DESC`)
    const page = new Map(
      path.map((row) => [
        row.id,
        {
          id: row.id,
          role: row.role,
          metadata: { status: row.status },
          parts: [] as CherryMessagePart[],
          partIds: [] as string[]
        }
      ])
    )
    const ids = [...page.keys()]
    const stored = sessionMessagePartsTable
    for (let start = 0; start < ids.length; start += 500) {
      const parts = db
        .select({ id: stored.id, messageId: stored.messageId, payload: stored.payload })
        .from(stored)
        .where(inArray(stored.messageId, ids.slice(start, start + 500)))
        .orderBy(asc(stored.messageId), asc(stored.seq))
        .all()
      for (const part of parts) {
        const message = page.get(part.messageId)!
        message.parts.push(part.payload)
        message.partIds.push(part.id)
      }
    }
    const parent = path[0]?.parent_id
    const nextCursor =
      parent &&
      db
        .select({ role: sessionMessagesTable.role })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.id, parent))
        .get()?.role !== 'root'
        ? parent
        : undefined
    return { items: [...page.values()], nextCursor }
  }

  lastTimelinePosition(sessionId: string): number {
    const session = application
      .get('DbService')
      .getDb()
      .select({ pos: sessionTable.lastPos })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .get()
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)
    return session.pos
  }

  saveInputTimelinePosition(
    sessionId: string,
    messageId: string,
    contextId: string,
    after = 0,
    followupReply?: Pick<CreateAgentSessionMessageDto, 'modelId' | 'messageSnapshot'> & {
      promotion?: { replyId?: string }
    }
  ): number | undefined {
    const result = application.get('DbService').withWriteTx((tx) => {
      const saved = tx
        .update(sessionMessagesTable)
        .set({
          pos: sql`max(${after}, (SELECT last_pos FROM agent_session WHERE id = ${sessionId})) + 1`,
          updatedAt: sessionMessagesTable.updatedAt
        })
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.role, 'user'),
            eq(sessionMessagesTable.inputContextId, contextId),
            ne(sessionMessagesTable.status, 'paused'),
            isNull(sessionMessagesTable.pos)
          )
        )
        .returning({ pos: sessionMessagesTable.pos })
        .get()
      if (saved?.pos == null) return undefined
      advanceAgentSessionPositionTx(tx, sessionId, saved.pos)
      const published = this.publishStagedFollowupTx(tx, sessionId, messageId, contextId)
      let replyId: string | undefined
      if (followupReply && (published || followupReply.promotion)) {
        const steerReplyId = followupReply.promotion?.replyId
        const steerReply = steerReplyId
          ? tx
              .select({ id: sessionMessagesTable.id })
              .from(sessionMessagesTable)
              .where(
                and(
                  eq(sessionMessagesTable.sessionId, sessionId),
                  eq(sessionMessagesTable.id, steerReplyId),
                  eq(sessionMessagesTable.role, 'assistant')
                )
              )
              .get()
          : undefined
        if (!steerReply) {
          const model = followupReply.modelId
            ? tx
                .select({ id: userModelTable.id })
                .from(userModelTable)
                .where(eq(userModelTable.id, followupReply.modelId))
                .get()
            : undefined
          replyId = this.saveMessageTx(tx, {
            sessionId,
            parentId: messageId,
            message: {
              messageSnapshot: followupReply.messageSnapshot,
              modelId: model?.id,
              role: 'assistant',
              status: 'pending',
              data: { parts: [] }
            }
          }).entity.id
        }
        tx.update(sessionMessagesTable)
          .set({ replyId: steerReply?.id ?? replyId })
          .where(eq(sessionMessagesTable.id, messageId))
          .run()
      }
      return { pos: saved.pos, published, replyId }
    })
    if (result?.published || result?.replyId)
      this.publishDeliveryMutation(
        [messageId, ...(result.replyId ? [result.replyId] : [])].map((id) => ({
          sessionId,
          messageId: id,
          kind: 'membership'
        })),
        [sessionId]
      )
    else if (result)
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds: [messageId]
        }
      ])
    return result?.pos
  }

  private publishStagedFollowupTx(tx: DbOrTx, sessionId: string, messageId: string, contextId?: string): boolean {
    const row = tx
      .select({ parentId: sessionMessagesTable.parentId })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.id, messageId),
          sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') = 1`
        )
      )
      .get()
    if (!row?.parentId) return false
    const parentId = this.branchTip(sessionId, row.parentId, tx, contextId)
    tx.update(sessionMessagesTable)
      .set({ parentId, data: sql`json_remove(${sessionMessagesTable.data}, '$.stagedFollowup')` })
      .where(eq(sessionMessagesTable.id, messageId))
      .run()
    advanceAgentSessionHeadTx(tx, sessionId, parentId, messageId)
    agentSessionService.advanceLastActivityAtTx(tx, sessionId, Date.now())
    return true
  }

  publishStagedFollowup(sessionId: string, messageId: string): void {
    const published = application
      .get('DbService')
      .withWriteTx((tx) => this.publishStagedFollowupTx(tx, sessionId, messageId))
    if (published) this.publishDeliveryChange(sessionId, messageId, 'membership')
  }

  isStagedFollowup(sessionId: string, messageId: string): boolean {
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.id, messageId),
            sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') = 1`
          )
        )
        .get()
    )
  }

  stagedFollowups(sessionId: string) {
    return application
      .get('DbService')
      .getDb()
      .select({
        messageId: sessionMessagesTable.id,
        contextId: sessionMessagesTable.inputContextId
      })
      .from(sessionMessagesTable)
      .innerJoin(sessionTable, eq(sessionTable.id, sessionMessagesTable.sessionId))
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          isNull(sessionTable.deletedAt),
          sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') = 1`
        )
      )
      .orderBy(asc(sessionMessagesTable.createdAt), asc(sessionMessagesTable.id))
      .all()
  }

  stageRestoredFollowups(sessionId: string, contextId: string, messageIds: readonly string[]): void {
    if (!messageIds.length) return
    const changed = application.get('DbService').withWriteTx((tx) => {
      const staged: string[] = []
      for (const id of messageIds) {
        const row = tx
          .update(sessionMessagesTable)
          .set({ data: sql`json_set(${sessionMessagesTable.data}, '$.stagedFollowup', json('true'))` })
          .where(
            and(
              eq(sessionMessagesTable.sessionId, sessionId),
              eq(sessionMessagesTable.id, id),
              eq(sessionMessagesTable.inputContextId, contextId),
              eq(sessionMessagesTable.status, 'success'),
              isNull(sessionMessagesTable.pos),
              isNull(sessionMessagesTable.replyId),
              sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') IS NULL`
            )
          )
          .returning({ parentId: sessionMessagesTable.parentId })
          .get()
        if (!row?.parentId) continue
        tx.update(sessionMessagesTable)
          .set({ parentId: row.parentId, updatedAt: sessionMessagesTable.updatedAt })
          .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.parentId, id)))
          .run()
        advanceAgentSessionHeadTx(tx, sessionId, id, row.parentId)
        staged.push(id)
      }
      return staged
    })
    this.publishDeliveryMutation(changed.map((messageId) => ({ sessionId, messageId, kind: 'membership' })))
  }

  bindInputContextTx(tx: DbOrTx, sessionId: string, messageId: string, contextId: string): SessionMessage {
    this.assertActiveSession(tx, sessionId)
    const row = this.findExistingMessageRow(tx, sessionId, messageId)
    if (!row || row.role !== 'user') throw new Error('Input binding requires a retained user message')
    const context = tx.select().from(agentSessionContextTable).where(eq(agentSessionContextTable.id, contextId)).get()
    if (!context?.anchorMessageId || context.sessionId !== sessionId)
      throw new Error('Input context is unavailable for this session')
    if (row.inputContextId) {
      const previous = tx
        .select()
        .from(agentSessionContextTable)
        .where(eq(agentSessionContextTable.id, row.inputContextId))
        .get()
      if (!context.checkpointMapping?.referenceHistory || previous?.anchorMessageId || previous?.parentContextId)
        throw new Error('Message already bound; create a new input')
    }
    tx.update(sessionMessagesTable)
      .set({
        inputContextId: contextId,
        nativeInputId: null,
        data:
          row.inputContextId && row.data.locallyHandled
            ? sql`json_remove(${sessionMessagesTable.data}, '$.locallyHandled')`
            : undefined
      })
      .where(eq(sessionMessagesTable.id, messageId))
      .run()
    return row
  }

  releaseInputBindingTx(tx: DbOrTx, sessionId: string, messageId: string, contextId: string): boolean {
    const result = tx
      .update(sessionMessagesTable)
      .set({ inputContextId: null })
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.inputContextId, contextId),
          isNull(sessionMessagesTable.nativeInputId),
          isNull(sessionMessagesTable.pos),
          sql`coalesce(json_extract(${sessionMessagesTable.data}, '$.locallyHandled'), 0) = 0`
        )
      )
      .run()
    return result.changes > 0
  }

  captureHead(sessionId: string): string {
    return application.get('DbService').withWriteTx((tx) => {
      this.assertActiveSession(tx, sessionId)
      return getAgentSessionHead(tx, sessionId) ?? ensureAgentSessionRootTx(tx, sessionId)
    })
  }

  sharesBranch(sessionId: string, left: string, right: string): boolean {
    const db = application.get('DbService').getDb()
    return (
      left === right ||
      readAgentSessionAncestry(db, sessionId, left).some((row) => row.id === right) ||
      readAgentSessionAncestry(db, sessionId, right).some((row) => row.id === left)
    )
  }

  branchTip(
    sessionId: string,
    messageId: string,
    db: DbOrTx = application.get('DbService').getDb(),
    contextId?: string
  ): string {
    const [leaf] = db.all<{ id: string }>(sql`
      WITH RECURSIVE branch(id, depth) AS (
        SELECT id, 0 FROM agent_session_message WHERE session_id = ${sessionId} AND id = ${messageId}
          AND json_extract(data, '$.stagedFollowup') IS NULL
        UNION ALL
        SELECT child.id, branch.depth + 1 FROM branch
        JOIN agent_session_message child ON child.id = (
          SELECT id FROM agent_session_message
          WHERE session_id = ${sessionId} AND parent_id = branch.id
            AND json_extract(data, '$.stagedFollowup') IS NULL
          ${
            contextId
              ? sql`AND NOT EXISTS (
            SELECT 1 FROM agent_session_context c WHERE c.session_id = ${sessionId}
            AND c.anchor_message_id = agent_session_message.id AND c.id != ${contextId}
          )`
              : sql``
          }
          -- Sort only this parent's children; the session-time index otherwise rescans the session per level.
          ORDER BY +created_at DESC, +id DESC LIMIT 1
        )
      )
      SELECT id FROM branch ORDER BY depth DESC LIMIT 1
    `)
    if (!leaf) throw DataApiErrorFactory.notFound('Message parent', messageId)
    return leaf.id
  }

  selectBranch(sessionId: string, messageId: string): void {
    const head = application.get('DbService').withWriteTx((tx) => {
      this.assertActiveSession(tx, sessionId)
      const head = this.branchTip(sessionId, messageId, tx)
      tx.update(sessionTable).set({ activeNodeId: head }).where(eq(sessionTable.id, sessionId)).run()
      return head
    })
    this.branchSelected.fire({ sessionId, head })
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', routeParams: { sessionId } }
    ])
  }

  readEditSnapshotTx(tx: DbOrTx, sessionId: string, messageId: string) {
    const snapshot = this.readEditVersionTx(tx, sessionId, messageId)
    const byId = new Map(snapshot.rows.map((row) => [row.id, row]))
    const prefix = this.applyForkCheckpointsTx(
      tx,
      sessionId,
      messageId,
      snapshot.plan.prefixIds.map((id) => byId.get(id)!)
    )
    const previous = prefix.find((row) => row.id === snapshot.plan.resolution.boundary?.id)
    const boundary = previous
      ? { id: previous.id, role: previous.role, status: previous.status, anchor: previous.data.runtimeAnchor }
      : snapshot.plan.resolution.boundary
    return {
      session: snapshot.session,
      workspace: snapshot.workspace,
      user: snapshot.user,
      version: snapshot.version,
      plan: { ...snapshot.plan, [editVersion]: snapshot.version },
      prefix,
      boundary
    }
  }

  private readEditVersionTx(tx: DbOrTx, sessionId: string, messageId: string) {
    this.assertActiveSession(tx, sessionId)
    const source = tx
      .select({ session: sessionTable, workspace: agentWorkspaceTable })
      .from(sessionTable)
      .innerJoin(agentWorkspaceTable, eq(sessionTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionTable.id, sessionId))
      .get()!
    const resolution = this.readRunHistoryTx(tx, sessionId).edit(messageId)
    if (resolution.kind !== 'ready')
      throw new AgentSessionEditError(resolution.kind === 'invalid' ? 'invalid_target' : 'checkpoint_unsupported')
    const rows = readAgentSessionPath(tx, sessionId)
    const user = rows.find((row) => row.id === messageId)
    if (!user || user.role !== 'user' || user.delivery || source.session.type !== 'conversation')
      throw new AgentSessionEditError('invalid_target')
    if (
      tx
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          or(
            and(
              eq(sessionMessagesTable.sessionId, sessionId),
              or(
                inArray(sessionMessagesTable.status, ['pending', 'streaming']),
                inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
              )
            ),
            and(
              eq(sessionMessagesTable.deliverySenderSessionId, sessionId),
              inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
            )
          )
        )
        .limit(1)
        .get()
    )
      throw new AgentSessionEditError('busy')
    return {
      ...source,
      rows,
      user,
      plan: resolution.plan,
      version: createHash('sha256').update(JSON.stringify({ source, rows })).digest('hex')
    }
  }

  replaceEditBranchTx(tx: DbOrTx, sessionId: string, plan: RunEditPlan & { readonly [editVersion]: string }): void {
    const snapshot = this.readEditVersionTx(tx, sessionId, plan.targetInputId)
    if (snapshot.version !== plan[editVersion]) throw new AgentSessionEditError('history_changed')
    const root = ensureAgentSessionRootTx(tx, sessionId)
    for (const change of plan.parentChanges) {
      tx.update(sessionMessagesTable)
        .set({ parentId: change.parentId ?? root })
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, change.messageId)))
        .run()
    }
    const replaced = and(
      eq(sessionMessagesTable.sessionId, sessionId),
      inArray(sessionMessagesTable.id, agentSessionDescendantIds(sessionId, plan.targetInputId))
    )
    const rows = tx.select({ id: sessionMessagesTable.id }).from(sessionMessagesTable).where(replaced).all()
    agentSessionContextService.removeRootMessagesTx(
      tx,
      sessionId,
      rows.map((row) => row.id)
    )
    tx.update(sessionTable)
      .set({ activeNodeId: plan.retainedHeadId ?? root })
      .where(eq(sessionTable.id, sessionId))
      .run()
    tx.delete(sessionMessagesTable).where(replaced).run()
    for (const row of rows) deleteMessageProvenanceTx(tx, sessionId, row.id)
    if (rows.length) refreshImportedHistoryMessageCountTx(tx, sessionId)
  }

  hasRuntimeResumeToken(sessionId: string, resumeToken: string, contextId?: string): boolean {
    if (
      application
        .get('DbService')
        .getDb()
        .select({ id: agentSessionContextTable.id })
        .from(agentSessionContextTable)
        .where(
          and(
            eq(agentSessionContextTable.sessionId, sessionId),
            contextId ? eq(agentSessionContextTable.id, contextId) : undefined,
            eq(agentSessionContextTable.bindingState, 'bound'),
            eq(agentSessionContextTable.nativeThreadId, resumeToken)
          )
        )
        .get()
    )
      return true
    if (contextId) return false
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.runtimeResumeToken, resumeToken))
        )
        .limit(1)
        .get()
    )
  }

  setEditRuntimeTx(tx: DbOrTx, sessionId: string, userMessageId: string, nativeSessionId: string): void {
    tx.update(sessionMessagesTable)
      .set({ data: sql`json_set(${sessionMessagesTable.data}, '$.nativeSessionId', ${nativeSessionId})` })
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, userMessageId)))
      .run()
  }

  private nativePath(sessionId: string, messageId?: string) {
    const db = application.get('DbService').getDb()
    const head = messageId ?? getAgentSessionHead(db, sessionId)
    if (!head) return []
    const rows = db
      .select({
        id: sessionMessagesTable.id,
        parentId: sessionMessagesTable.parentId,
        runtimeResumeToken: sessionMessagesTable.runtimeResumeToken,
        nativeSessionId: sql<string | null>`json_extract(${sessionMessagesTable.data}, '$.nativeSessionId')`
      })
      .from(sessionMessagesTable)
      .where(inArray(sessionMessagesTable.id, agentSessionPathIds(sessionId, head)))
      .all()
    return orderAgentSessionPath(rows, head)
  }

  getNativeSessionId(sessionId: string, messageId?: string): string | undefined {
    const rows = this.nativePath(sessionId, messageId).toReversed()
    const row = rows.find((row) => row.nativeSessionId || row.runtimeResumeToken)
    return row?.nativeSessionId ?? row?.runtimeResumeToken ?? undefined
  }

  /** Main-only native fork read. API callers must never receive these raw rows. */
  readForkPrefixTx(
    tx: DbOrTx,
    sessionId: string,
    messageId: string,
    excludedIds: readonly string[] = []
  ): SessionMessage[] | undefined {
    const plan = this.readRunHistoryTx(tx, sessionId, messageId).fork(messageId, excludedIds)
    if (!plan) return undefined
    const rows = chunk([...plan.messageIds], 500).flatMap((ids) =>
      tx
        .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), inArray(sessionMessagesTable.id, ids)))
        .all()
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    const messages = hydrateAgentSessionMessageRowsTx(
      tx,
      attachAgentSessionMessagePartsTx(
        tx,
        plan.messageIds.map((id) => byId.get(id)!),
        true
      )
    )
    return this.applyForkCheckpointsTx(tx, sessionId, messageId, messages)
  }

  readRunHistoryTx(tx: DbOrTx, sessionId: string, messageId?: string) {
    const activeHead = getAgentSessionHead(tx, sessionId)
    const metadata = (head: string) =>
      tx
        .select()
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            inArray(sessionMessagesTable.id, agentSessionPathIds(sessionId, head))
          )
        )
        .all()
    let head = activeHead
    let rows = head ? metadata(head) : []
    if (messageId && !rows.some((row) => row.id === messageId)) {
      if (!metadata(messageId).some((row) => row.id === messageId)) return resolveAgentSessionRunHistory([])
      head = this.branchTip(sessionId, messageId, tx)
      rows = metadata(head)
    }
    return resolveAgentSessionRunHistory(head ? orderAgentSessionPath(rows, head) : [])
  }

  private applyForkCheckpointsTx(
    tx: DbOrTx,
    sessionId: string,
    messageId: string,
    rows: SessionMessage[]
  ): SessionMessage[] {
    const context = agentSessionContextService.branchTx(tx, sessionId, messageId)
    const mapping = context?.checkpointMapping?.fork
    return rows.map((row) => {
      const anchor = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor)
      const importedCheckpoint = anchor.data?.checkpoint
      const checkpoint =
        row.data.importedHistory &&
        importedCheckpoint?.runtime === 'pi-durable' &&
        context &&
        importedCheckpoint.backendId === context.backendId &&
        context.nativeThreadId
          ? { ...importedCheckpoint, conversationId: context.nativeThreadId }
          : mapping?.[row.id]
      return checkpoint && anchor.success && context
        ? {
            ...row,
            runtimeResumeToken: context.nativeThreadId,
            data: { ...row.data, runtimeAnchor: { ...anchor.data, checkpoint } }
          }
        : row
    })
  }

  insertImportedMessagesTx(
    tx: DbOrTx,
    sessionId: string,
    rows: readonly Pick<
      SessionMessage,
      | 'id'
      | 'parentId'
      | 'role'
      | 'data'
      | 'status'
      | 'messageSnapshot'
      | 'runtimeResumeToken'
      | 'createdAt'
      | 'updatedAt'
    >[],
    activeNodeId: string | null
  ): void {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    for (const row of rows) {
      const { storedData, offloaded, retainedToolCallIds } = this.extractMessageToolOutputs(sessionId, row.id, row.data)
      const { data, parts } = splitAgentSessionMessageData(storedData)
      tx.insert(sessionMessagesTable)
        .values({ ...row, data, sessionId, parentId: row.parentId ?? root })
        .run()
      replaceAgentSessionMessagePartsTx(tx, { sessionId, messageId: row.id, parts, timestampMs: row.updatedAt })
      syncMessageToolOutputsTx(tx, sessionId, row.id, offloaded, retainedToolCallIds, undefined, row.updatedAt)
      replaceAgentSessionMessageFileRefsTx(tx, row.id, row.data)
    }
    tx.update(sessionTable)
      .set({ activeNodeId: activeNodeId ?? root })
      .where(eq(sessionTable.id, sessionId))
      .run()
  }

  /** Inserts historical facts only, never delivery, billing, queue or approval ownership. */
  insertForkMessagesTx(tx: DbOrTx, sessionId: string, rows: readonly SessionMessage[]): void {
    let parentId = ensureAgentSessionRootTx(tx, sessionId)
    for (const row of rows) {
      const { storedData, offloaded, retainedToolCallIds } = this.extractMessageToolOutputs(sessionId, row.id, row.data)
      const { data, parts } = splitAgentSessionMessageData(storedData)
      delete data.localSessionCost
      delete data.localTurnUsage
      tx.insert(sessionMessagesTable)
        .values({
          id: row.id,
          parentId,
          sessionId,
          role: row.role,
          pos: row.pos,
          replyId: row.replyId,
          data,
          status: row.status,
          modelId: row.modelId,
          messageSnapshot: row.messageSnapshot,
          runtimeResumeToken: row.runtimeResumeToken,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })
        .run()
      replaceAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId: row.id,
        parts,
        partIds: row.partIds,
        positions: new Map(
          (row.partIds ?? []).flatMap((id, index) => {
            const pos = row.partPositions?.[index]
            return pos == null ? [] : [[id, pos] as const]
          })
        ),
        timestampMs: row.updatedAt
      })
      if (row.pos != null) advanceAgentSessionPositionTx(tx, sessionId, row.pos)
      syncMessageToolOutputsTx(tx, sessionId, row.id, offloaded, retainedToolCallIds, undefined, row.updatedAt)
      if (row.provenance) setMessageProvenanceTx(tx, sessionId, row.id, row.provenance)
      replaceAgentSessionMessageFileRefsTx(tx, row.id, row.data)
      advanceAgentSessionHeadTx(tx, sessionId, parentId, row.id)
      parentId = row.id
    }
  }

  private invalidateForkPrefixTx(tx: DbOrTx, sessionId: string, messageId: string): void {
    const row = this.findExistingMessageRow(tx, sessionId, messageId)
    if (!row) return
    tx.update(sessionMessagesTable)
      .set({
        data: sql`json_remove(${sessionMessagesTable.data}, '$.runtimeAnchor')`,
        updatedAt: Date.now()
      })
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          inArray(sessionMessagesTable.id, agentSessionDescendantIds(sessionId, messageId)),
          sql`json_type(${sessionMessagesTable.data}, '$.runtimeAnchor') is not null`
        )
      )
      .run()
  }

  search(query: SessionMessageContentSearchInput) {
    const db = application.get('DbService').getDb()
    const messageSessionCondition = query.sessionId ? sql`sm.session_id = ${query.sessionId}` : sql`1 = 1`

    return searchWithCursor<SessionMessageSearchRow, SessionMessageContentSearchItem>({
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      createdAtFrom: query.createdAtFrom,
      cursorConfig: MESSAGE_CURSOR_CONFIG,
      fetchRows: ({ ftsConditions, cursor, createdAtFromMs, offset, chunkSize }: SearchFetchContext) => {
        const createdAtCondition = createdAtFromMs !== undefined ? sql`sm.created_at >= ${createdAtFromMs}` : sql`1 = 1`

        return db.all<SessionMessageSearchRow>(sql`
          SELECT
            sm.id AS "rowId",
            sm.searchable_text AS "searchableText",
            sm.session_id AS "sessionId",
            s.name AS "sessionName",
            s.agent_id AS "agentId",
            a.name AS "agentName",
            sm.role,
            sm.created_at AS "createdAt"
          FROM agent_session_message sm
          JOIN agent_session_message_fts fts ON sm.fts_rowid = fts.rowid
          JOIN agent_session s ON s.id = sm.session_id
          LEFT JOIN agent a ON a.id = s.agent_id
          WHERE s.type = 'conversation' AND sm.searchable_text != ''
            AND s.deleted_at IS NULL
            AND json_extract(sm.data, '$.stagedFollowup') IS NULL
            AND ${messageSessionCondition}
            AND ${createdAtCondition}
            AND ${sql.join(ftsConditions, sql` AND `)}
            AND ${
              cursor
                ? sql`(sm.created_at < ${cursor.createdAt} OR (sm.created_at = ${cursor.createdAt} AND sm.id < ${cursor.id}))`
                : sql`1 = 1`
            }
          ORDER BY sm.created_at DESC, sm.id DESC
          LIMIT ${chunkSize}
          OFFSET ${offset}
        `)
      },
      getSearchableText: (row) => row.searchableText,
      buildSnippet: buildSearchSnippet,
      mapRow: (row, { snippet }) => ({
        item: mapSessionMessageSearchRow(row, snippet),
        sort: {
          createdAt: Number(row.createdAt),
          id: row.rowId
        }
      })
    })
  }

  /** BM25-ranked search for the Agent tool; ordinary DataApi search keeps its chronological cursor contract. */
  searchRanked(query: RankedSessionMessageSearchInput): SessionMessageContentSearchItem[] {
    const database = application.get('DbService').getDb()
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), 100)
    const agentCondition = query.agentId ? sql`s.agent_id = ${query.agentId}` : sql`1 = 1`
    const addressableCondition = query.addressableOnly
      ? sql`s.agent_id IS NOT NULL AND a.id IS NOT NULL AND a.deleted_at IS NULL`
      : sql`1 = 1`
    const matchQuery = toFtsMatchQuery(query.q)
    const snippetTerms = [...extractMatchTerms(query.q), ...extractShortTerms(query.q)]

    const fetchMatchRows = (shortTerms: string[], chunkLimit: number, offset: number): SessionMessageSearchRow[] => {
      if (!matchQuery) return []
      const shortTermConditions = shortTerms.map(
        (term) => sql`sm.searchable_text LIKE ${toFtsLikePattern(term)} ESCAPE '\\'`
      )
      return database.all<SessionMessageSearchRow>(sql`
        SELECT
          sm.id AS "rowId",
          sm.searchable_text AS "searchableText",
          sm.session_id AS "sessionId",
          s.name AS "sessionName",
          s.agent_id AS "agentId",
          a.name AS "agentName",
          sm.role,
          sm.created_at AS "createdAt"
        FROM agent_session_message_fts
        JOIN agent_session_message sm ON sm.fts_rowid = agent_session_message_fts.rowid
        JOIN agent_session s ON s.id = sm.session_id
        LEFT JOIN agent a ON a.id = s.agent_id
        WHERE s.type = 'conversation' AND agent_session_message_fts MATCH ${matchQuery}
            AND s.deleted_at IS NULL
          AND json_extract(sm.data, '$.stagedFollowup') IS NULL
          AND ${agentCondition}
          AND ${addressableCondition}
          ${shortTermConditions.length > 0 ? sql`AND ${sql.join(shortTermConditions, sql` AND `)}` : sql``}
        ORDER BY bm25(agent_session_message_fts), sm.created_at DESC, sm.id DESC
        LIMIT ${chunkLimit}
        OFFSET ${offset}
      `)
    }

    const collectDistinctSessions = (
      fetchRows: (chunkLimit: number, offset: number) => SessionMessageSearchRow[]
    ): SessionMessageSearchRow[] => {
      const rows: SessionMessageSearchRow[] = []
      const seenSessionIds = new Set<string>()
      const chunkLimit = Math.max(limit, 20)
      const scanLimit = chunkLimit * RANKED_SESSION_SEARCH_SCAN_MULTIPLIER
      let offset = 0
      while (rows.length < limit && offset < scanLimit) {
        const chunk = fetchRows(Math.min(chunkLimit, scanLimit - offset), offset)
        for (const row of chunk) {
          if (seenSessionIds.has(row.sessionId)) continue
          seenSessionIds.add(row.sessionId)
          rows.push(row)
          if (rows.length === limit) break
        }
        if (chunk.length < chunkLimit) break
        offset += chunk.length
      }
      return rows
    }

    let rows: SessionMessageSearchRow[]
    if (needsLikeFallback(query.q)) {
      const terms = [...new Set(extractFtsTokens(query.q))].slice(0, RANKED_SESSION_SEARCH_MAX_FALLBACK_TERMS)
      if (terms.length === 0) return []
      const conditions = terms.map((term) => sql`sm.searchable_text LIKE ${toFtsLikePattern(term)} ESCAPE '\\'`)
      rows = collectDistinctSessions((chunkLimit, offset) =>
        database.all<SessionMessageSearchRow>(sql`
          SELECT
            sm.id AS "rowId",
            sm.searchable_text AS "searchableText",
            sm.session_id AS "sessionId",
            s.name AS "sessionName",
            s.agent_id AS "agentId",
            a.name AS "agentName",
            sm.role,
            sm.created_at AS "createdAt"
          FROM agent_session_message sm
          JOIN agent_session s ON s.id = sm.session_id
          LEFT JOIN agent a ON a.id = s.agent_id
          WHERE s.type = 'conversation' AND ${agentCondition}
            AND s.deleted_at IS NULL
            AND json_extract(sm.data, '$.stagedFollowup') IS NULL
            AND ${addressableCondition}
            AND ${sql.join(conditions, sql` AND `)}
          ORDER BY length(sm.searchable_text), sm.created_at DESC, sm.id DESC
          LIMIT ${chunkLimit}
          OFFSET ${offset}
        `)
      )
      return rows.map((row) =>
        mapSessionMessageSearchRow(row, buildSearchSnippet(row.searchableText, terms, 'substring'))
      )
    }

    const shortTerms = extractShortTerms(query.q)
    rows = collectDistinctSessions((chunkLimit, offset) => fetchMatchRows(shortTerms, chunkLimit, offset))
    if (rows.length === 0 && shortTerms.length > 0) {
      rows = collectDistinctSessions((chunkLimit, offset) => fetchMatchRows([], chunkLimit, offset))
    }
    return rows.map((row) =>
      mapSessionMessageSearchRow(row, buildSearchSnippet(row.searchableText, snippetTerms, 'substring'))
    )
  }

  /**
   * Lightweight existence check used to distinguish an untouched session's
   * initial turn without loading a potentially large message payload.
   */
  hasSessionMessages(sessionId: string, excludingMessageId?: string): boolean {
    const database = application.get('DbService').getDb()
    return (
      database
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            ne(sessionMessagesTable.role, 'root'),
            excludingMessageId ? ne(sessionMessagesTable.id, excludingMessageId) : undefined
          )
        )
        .limit(1)
        .all().length > 0
    )
  }

  hasSessionMessage(sessionId: string, messageId: string): boolean {
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, messageId)))
        .limit(1)
        .get()
    )
  }

  listLiveCreatedInRangeMetadataPage({
    fromMs,
    toMs,
    sessionId,
    cursor: rawCursor,
    limit
  }: {
    fromMs: number
    toMs: number
    sessionId?: string
    cursor?: string
    limit: number
  }): CursorPaginationResponse<AgentSessionMessageRangeMetadata> {
    const ordering = keysetOrdering(sessionMessagesTable.createdAt, sessionMessagesTable.id, {
      major: 'desc',
      tie: 'asc'
    })
    const cursor = decodeListCursor(rawCursor, asNumericKey, 'agent-session-message-range-metadata')
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        createdAt: sessionMessagesTable.createdAt,
        entityJsonBytes: agentSessionMessageEntityJsonBytes(),
        id: sessionMessagesTable.id,
        sessionId: sessionMessagesTable.sessionId
      })
      .from(sessionMessagesTable)
      .innerJoin(sessionTable, eq(sessionTable.id, sessionMessagesTable.sessionId))
      .where(
        and(
          ne(sessionMessagesTable.role, 'root'),
          gte(sessionMessagesTable.createdAt, fromMs),
          lte(sessionMessagesTable.createdAt, toMs),
          isNull(sessionTable.deletedAt),
          sessionId === undefined ? undefined : eq(sessionMessagesTable.sessionId, sessionId),
          cursor ? ordering.where(cursor) : undefined
        )
      )
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const tail = pageRows[pageRows.length - 1]
    return {
      items: pageRows.map((row) => ({
        ...row,
        createdAt: timestampToISO(row.createdAt)
      })),
      nextCursor: hasNext && tail ? encodeCursor(tail.createdAt, tail.id) : undefined
    }
  }

  /**
   * Cursor-paginated message read. Walks newest-first; an absent cursor
   * returns the most recent page, each `nextCursor` walks one page older.
   * WorkBuddy cursors preserve the imported prefix independently of timestamps.
   */
  listSessionMessages(
    sessionId: string,
    options: ListSessionMessagesOptions = {}
  ): CursorPaginationResponse<AgentSessionMessageEntity> {
    const database = application.get('DbService').getDb()

    this.assertActiveSession(database, sessionId)

    const limit = Math.min(options.limit ?? AGENT_SESSION_MESSAGES_DEFAULT_LIMIT, AGENT_SESSION_MESSAGES_MAX_LIMIT)
    const ordering = sessionMessageOrdering(database, sessionId, 'desc')
    const cursor = ordering.fromCursor(options.cursor)
    const [anchor] = options.messageId
      ? database
          .select({
            id: sessionMessagesTable.id,
            createdAt: sessionMessagesTable.createdAt,
            provenance: messageProvenanceSql()
          })
          .from(sessionMessagesTable)
          .where(
            and(
              eq(sessionMessagesTable.sessionId, sessionId),
              eq(sessionMessagesTable.id, options.messageId),
              sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') IS NULL`
            )
          )
          .limit(1)
          .all()
      : []
    if (!options.cursor && options.messageId && !anchor) {
      logger.warn('Session message anchor not found, falling back to newest page', {
        sessionId,
        messageId: options.messageId
      })
    }

    const head = anchor?.id ?? getAgentSessionHead(database, sessionId)
    const filters = [
      eq(sessionMessagesTable.sessionId, sessionId),
      ne(sessionMessagesTable.role, 'root'),
      head ? inArray(sessionMessagesTable.id, agentSessionPathIds(sessionId, head)) : sql`0`
    ]
    if (cursor) {
      filters.push(cursor)
    } else if (anchor) {
      filters.push(ordering.whereRow(anchor, true))
    }

    const rows = database
      .select({
        id: sessionMessagesTable.id,
        parentId: sessionMessagesTable.parentId,
        createdAt: sessionMessagesTable.createdAt,
        provenance: messageProvenanceSql()
      })
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const readRow = database
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, sql.placeholder('id')))
      .prepare()
    let selectedRows = pageRows.map(({ id }) => readRow.get({ id })!)
    const ownerIds = [...new Set(selectedRows.flatMap((row) => (row.replyId ? [row.replyId] : [])))]
    const pageTail = pageRows.at(-1)
    const owner =
      hasNext && pageTail && ownerIds.length
        ? database
            .select({
              id: sessionMessagesTable.id,
              createdAt: sessionMessagesTable.createdAt,
              provenance: messageProvenanceSql()
            })
            .from(sessionMessagesTable)
            .where(
              and(
                ...filters,
                inArray(sessionMessagesTable.id, ownerIds),
                eq(sessionMessagesTable.role, 'assistant'),
                ordering.whereRow(pageTail)
              )
            )
            .orderBy(...sessionMessageOrdering(database, sessionId, 'asc').orderBy)
            .limit(1)
            .get()
        : undefined
    if (owner) {
      selectedRows = database
        .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
        .from(sessionMessagesTable)
        .where(and(...filters, not(ordering.whereRow(owner))))
        .orderBy(...ordering.orderBy)
        .all()
    }
    const storedRows = attachAgentSessionMessagePartsTx(database, selectedRows, options.deferToolOutputs)
    const items = this.toHistoryMessages(database, sessionId, storedRows, options.deferToolOutputs)
    const tail = selectedRows.at(-1)
    const nextCursor = hasNext && tail ? ordering.encode(tail) : undefined

    return { items, nextCursor }
  }

  private toHistoryMessages(
    database: DbOrTx,
    sessionId: string,
    storedRows: SessionMessage[],
    deferToolOutputs?: boolean
  ): AgentSessionMessageEntity[] {
    const parents = storedRows.flatMap((row) => (row.parentId ? [row.parentId] : []))
    const siblings = parents.length
      ? database
          .select({ id: sessionMessagesTable.id, parentId: sessionMessagesTable.parentId })
          .from(sessionMessagesTable)
          .where(
            and(
              eq(sessionMessagesTable.sessionId, sessionId),
              inArray(sessionMessagesTable.parentId, parents),
              sql`json_extract(${sessionMessagesTable.data}, '$.stagedFollowup') IS NULL`
            )
          )
          // Unary + keeps the planner on parent_idx instead of scanning the session through session_created_id_idx.
          .orderBy(asc(sql`+${sessionMessagesTable.createdAt}`), asc(sql`+${sessionMessagesTable.id}`))
          .all()
      : []
    const siblingsByParent = new Map<string | null, string[]>()
    for (const sibling of siblings) {
      const group = siblingsByParent.get(sibling.parentId)
      if (group) group.push(sibling.id)
      else siblingsByParent.set(sibling.parentId, [sibling.id])
    }
    const hydratedRows = deferToolOutputs ? storedRows : hydrateAgentSessionMessageRowsTx(database, storedRows)
    return hydratedRows.map((row) => {
      const entity = this.rowToEntity(row)
      if (deferToolOutputs && entity.role === 'assistant' && entity.data.parts) {
        entity.data = {
          ...entity.data,
          parts: projectMessagePartsForRenderer(
            entity.data.parts,
            buildAgentSessionTopicId(sessionId),
            entity.id,
            row.partIds
          )
        }
      }
      return {
        ...entity,
        ...(row.partIds && { partIds: row.partIds, partPositions: row.partPositions }),
        siblings: siblingsByParent.get(row.parentId) ?? []
      }
    })
  }

  listApprovalMessages(sessionId: string): AgentSessionMessageEntity[] {
    const database = application.get('DbService').getDb()
    this.assertActiveSession(database, sessionId)
    const rows = database
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          sql`exists (
        select 1 from agent_session_message_part as part
        where part.message_id = ${sessionMessagesTable.id} and json_extract(part.payload, '$.approval.id') is not null
      )`
        )
      )
      .orderBy(...sessionMessageOrdering(application.get('DbService').getDb(), sessionId, 'desc').orderBy)
      .all()
    return hydrateAgentSessionMessageRowsTx(database, attachAgentSessionMessagePartsTx(database, rows)).map((row) =>
      this.rowToEntity(row)
    )
  }

  deleteSessionMessage(sessionId: string, messageId: string): void {
    if (!messageId) {
      throw DataApiErrorFactory.validation({ messageId: ['must not be empty'] })
    }
    this.assertActiveSession(application.get('DbService').getDb(), sessionId)

    const result = withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.deleteSessionMessageTx(tx, sessionId, messageId)),
      defaultHandlersFor('Message', messageId)
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Message', messageId)
    }
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', routeParams: { sessionId } },
      ...(result.hasLocalTurnUsage || result.hasLocalSessionCost
        ? [{ endpoint: '/ai-usage-records/local' as const, kind: 'membership' as const }]
        : []),
      ...(result.hasLocalSessionCost
        ? [{ endpoint: '/agent-sessions/:sessionId/cost' as const, routeParams: { sessionId } }]
        : [])
    ])
  }

  getSessionMessage(
    sessionId: string,
    messageId: string,
    options: AgentSessionMessageReadQuery = {}
  ): AgentSessionMessageEntity {
    const database = application.get('DbService').getDb()
    this.assertActiveSession(database, sessionId)
    const row = this.findExistingMessageRow(database, sessionId, messageId, options.deferToolOutputs)
    if (!row || row.role === 'root') throw DataApiErrorFactory.notFound('Message', messageId)
    if (options.deferToolOutputs) return this.toHistoryMessages(database, sessionId, [row], true)[0]
    return this.rowToEntity(hydrateAgentSessionMessageRowsTx(database, [row])[0])
  }

  /** Reads the stored parts and their IDs without bringing sidecar output into the live projection. */
  getStoredMessageParts(sessionId: string, messageId: string) {
    const database = application.get('DbService').getDb()
    this.assertActiveSession(database, sessionId)
    const parts = sessionMessagePartsTable
    const rows = database
      .select({ partId: parts.id, pos: parts.pos, payload: parts.payload })
      .from(sessionMessagesTable)
      .leftJoin(parts, eq(parts.messageId, sessionMessagesTable.id))
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.id, messageId),
          ne(sessionMessagesTable.role, 'root')
        )
      )
      .orderBy(asc(parts.seq))
      .all()
    if (!rows.length) throw DataApiErrorFactory.notFound('Message', messageId)
    const topicId = buildAgentSessionTopicId(sessionId)
    return rows.flatMap(({ partId, pos, payload }) => {
      if (partId === null || payload === null) return []
      const part = this.bindStoredPart(payload, topicId, messageId, partId)
      return [{ partId, ...(pos === null ? {} : { pos }), payload: part }]
    })
  }

  getStoredMessagePart(sessionId: string, messageId: string, partId: string): CherryMessagePart | undefined {
    const database = application.get('DbService').getDb()
    const parts = sessionMessagePartsTable
    const row = database
      .select({ payload: parts.payload })
      .from(parts)
      .where(and(eq(parts.id, partId), eq(parts.messageId, messageId), eq(parts.sessionId, sessionId)))
      .get()
    return row ? this.bindStoredPart(row.payload, buildAgentSessionTopicId(sessionId), messageId, partId) : undefined
  }

  findStoredToolOwners(sessionId: string, toolCallId: string) {
    const parts = sessionMessagePartsTable
    return application
      .get('DbService')
      .getDb()
      .selectDistinct({ messageId: parts.messageId })
      .from(parts)
      .where(
        and(
          eq(parts.sessionId, sessionId),
          sql`(${parts.type} = 'dynamic-tool' OR ${parts.type} LIKE 'tool-%')`,
          sql`json_extract(${parts.payload}, '$.toolCallId') = ${toolCallId}`
        )
      )
      .all()
  }

  getStoredMessagePartFacts(sessionId: string, messageId: string) {
    const parts = sessionMessagePartsTable
    const tool = sql`${parts.type} = 'dynamic-tool' OR ${parts.type} LIKE 'tool-%'`
    const task = eq(parts.type, 'data-agent-task-event')
    return application
      .get('DbService')
      .getDb()
      .select({
        partId: parts.id,
        pos: parts.pos,
        type: parts.type,
        toolCallId: sql<string | null>`CASE WHEN ${tool} THEN json_extract(${parts.payload}, '$.toolCallId') END`,
        dataId: sql<
          string | null
        >`CASE WHEN ${parts.type} LIKE 'data-%' THEN json_extract(${parts.payload}, '$.id') END`,
        state: sql<string | null>`CASE WHEN ${tool} THEN json_extract(${parts.payload}, '$.state') END`,
        approvalId: sql<string | null>`CASE WHEN ${tool} THEN json_extract(${parts.payload}, '$.approval.id') END`,
        approved: sql<0 | 1 | null>`CASE WHEN ${tool} THEN json_extract(${parts.payload}, '$.approval.approved') END`,
        taskToolUseId: sql<
          string | null
        >`CASE WHEN ${task} THEN json_extract(${parts.payload}, '$.data.toolUseId') END`,
        taskStatus: sql<string | null>`CASE WHEN ${task} THEN json_extract(${parts.payload}, '$.data.status') END`
      })
      .from(parts)
      .where(and(eq(parts.sessionId, sessionId), eq(parts.messageId, messageId)))
      .orderBy(asc(parts.seq))
      .all()
  }

  private bindStoredPart(
    part: CherryMessagePart,
    topicId: string,
    messageId: string,
    partId: string
  ): CherryMessagePart {
    return isToolUIPart(part) &&
      (part.state === 'output-available' || part.state === 'output-error') &&
      isDeferredToolOutput(toolResultValue(part))
      ? projectMessagePartForRenderer(part, topicId, messageId, undefined, partId)
      : part
  }

  resolveToolResultMessageId(sessionId: string, partId: string, toolCallId: string): string | undefined {
    const part = sessionMessagePartsTable
    return application
      .get('DbService')
      .getDb()
      .select({ messageId: part.messageId })
      .from(part)
      .where(
        and(
          eq(part.id, partId),
          eq(part.sessionId, sessionId),
          sql`json_extract(${part.payload}, '$.toolCallId') = ${toolCallId}`
        )
      )
      .get()?.messageId
  }

  getSessionToolOutputRange(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    cursor: number,
    partId?: string
  ): { bytes: Buffer; hasMore: boolean } | undefined | null {
    const database = application.get('DbService').getDb()
    this.assertActiveSession(database, sessionId)
    const limit = 256 * 1024
    const body = storedToolOutput(partId)
    const row = database
      .select({
        bytes: sql<Buffer>`substr(cast(${body} as blob), ${cursor + 1}, ${limit + 4})`,
        total: sql<number>`length(cast(${body} as blob))`
      })
      .from(sessionToolOutputsTable)
      .where(
        and(
          eq(sessionToolOutputsTable.sessionId, sessionId),
          eq(sessionToolOutputsTable.messageId, messageId),
          eq(sessionToolOutputsTable.toolCallId, toolCallId)
        )
      )
      .get()
    if (!row) return undefined
    if (cursor > row.total || (row.bytes.length && (row.bytes[0] & 0xc0) === 0x80)) return null
    return { bytes: row.bytes, hasMore: cursor + row.bytes.length < row.total }
  }

  getSessionToolOutput(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    partId?: string
  ): { found: true; output: unknown } | { found: false } {
    const database = application.get('DbService').getDb()
    this.assertActiveSession(database, sessionId)
    const row = database
      .select({ output: storedToolOutput(partId).mapWith(sessionToolOutputsTable.output) })
      .from(sessionToolOutputsTable)
      .where(
        and(
          eq(sessionToolOutputsTable.messageId, messageId),
          eq(sessionToolOutputsTable.toolCallId, toolCallId),
          eq(sessionToolOutputsTable.sessionId, sessionId)
        )
      )
      .get()
    if (row) return { found: true, output: row.output }
    const message = this.findExistingMessageRow(database, sessionId, messageId)
    const part = message?.data.parts?.find(
      (part) =>
        isToolUIPart(part) &&
        part.toolCallId === toolCallId &&
        (part.state === 'output-available' || part.state === 'output-error')
    )
    if (!part || !isToolUIPart(part) || (part.state !== 'output-error' && part.state !== 'output-available'))
      return { found: false }
    const output = toolResultValue(part)
    return isDeferredToolOutput(output) ? { found: false } : { found: true, output }
  }

  getSessionCost(sessionId: string): AgentSessionCostSnapshot | null {
    const db = application.get('DbService').getDb()
    this.assertActiveSession(db, sessionId)
    const row = db
      .select({ snapshot: sql<string>`json_extract(${sessionMessagesTable.data}, '$.localSessionCost')` })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          sql`json_type(${sessionMessagesTable.data}, '$.localSessionCost') = 'object'`
        )
      )
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .limit(1)
      .get()
    return row ? AgentSessionCostSnapshotSchema.parse(JSON.parse(row.snapshot)) : null
  }

  saveSessionCost(sessionId: string, snapshot: AgentSessionCostSnapshot): void {
    const db = application.get('DbService').getDb()
    const latestMessage = db
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), ne(sessionMessagesTable.role, 'root')))
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .limit(1)
    const result = db
      .update(sessionMessagesTable)
      .set({
        data: sql`json_set(${sessionMessagesTable.data}, '$.localSessionCost', json(${JSON.stringify(snapshot)}))`
      })
      .where(inArray(sessionMessagesTable.id, latestMessage))
      .run()
    if (result.changes > 0) {
      notifyDataApiDataChange([
        { endpoint: '/ai-usage-records/local', kind: 'membership' },
        { endpoint: '/agent-sessions/:sessionId/cost', routeParams: { sessionId } },
        { endpoint: '/agent-sessions/:sessionId/messages', kind: 'projection', routeParams: { sessionId } }
      ])
    }
  }

  updateSessionMessage(
    sessionId: string,
    messageId: string,
    dto: UpdateAgentSessionMessageDto
  ): AgentSessionMessageEntity {
    const message = application.get('DbService').withWriteTx((tx) => {
      this.assertActiveSession(tx, sessionId)
      const existing = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existing) throw DataApiErrorFactory.notFound('Message', messageId)
      if (AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES.some((status) => status === existing.deliveryStatus))
        throw DataApiErrorFactory.resourceLocked('Message', messageId, 'an in-flight Session delivery')
      if (
        existing.inputContextId ||
        existing.data.nativeSessionId ||
        existing.data.stagedFollowup ||
        existing.role === 'root'
      )
        throw DataApiErrorFactory.resourceLocked('Message', messageId, 'native input binding')

      const updatedAt = Date.now()
      // PATCH callers send partial data (usually just parts); shallow-merge so
      // omitted keys like main-authoritative turnOptions survive the update.
      const mergedData: AgentSessionMessageData = publicMessageData({ ...existing.data, ...dto.data })
      delete mergedData.localTurnUsage
      if (existing.data.localTurnUsage) mergedData.localTurnUsage = existing.data.localTurnUsage
      delete mergedData.localSessionCost
      if (existing.data.localSessionCost) mergedData.localSessionCost = existing.data.localSessionCost
      if (existing.data.deliveryReplyAnchor) mergedData.deliveryReplyAnchor = existing.data.deliveryReplyAnchor
      this.invalidateForkPrefixTx(tx, sessionId, messageId)
      const { storedData, offloaded, retainedToolCallIds, hasDeferredInput } = this.extractMessageToolOutputs(
        sessionId,
        messageId,
        mergedData
      )
      const stored = splitAgentSessionMessageData(storedData)
      const [updated] = tx
        .update(sessionMessagesTable)
        .set({ data: stored.data, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .returning()
        .all()
      replaceAgentSessionMessagePartsTx(tx, { sessionId, messageId, parts: stored.parts, timestampMs: updatedAt })
      syncMessageToolOutputsTx(tx, sessionId, messageId, offloaded, retainedToolCallIds, existing.data, updatedAt)
      replaceAgentSessionMessageFileRefsTx(tx, messageId, mergedData)
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      return this.rowToEntity({
        ...updated,
        provenance: existing.provenance,
        data: hasDeferredInput ? hydrateAgentSessionMessageDataTx(tx, messageId, mergedData) : mergedData
      })
    })
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'projection', routeParams: { sessionId } }
    ])
    return message
  }

  deleteSessionMessageTx(
    tx: DbOrTx,
    sessionId: string,
    messageId: string
  ): { rowsAffected: number; hasLocalTurnUsage?: boolean; hasLocalSessionCost?: boolean } {
    const existing = tx
      .select({
        role: sessionMessagesTable.role,
        parentId: sessionMessagesTable.parentId,
        inputContextId: sessionMessagesTable.inputContextId,
        deliveryStatus: sessionMessagesTable.deliveryStatus,
        nativeSessionId: sql<string | null>`json_extract(${sessionMessagesTable.data}, '$.nativeSessionId')`,
        localTurnUsageType: sql<string | null>`json_type(${sessionMessagesTable.data}, '$.localTurnUsage')`,
        localSessionCostType: sql<string | null>`json_type(${sessionMessagesTable.data}, '$.localSessionCost')`
      })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, messageId)))
      .get()
    if (AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES.some((status) => status === existing?.deliveryStatus)) {
      throw DataApiErrorFactory.resourceLocked('Message', messageId, 'an in-flight Session delivery')
    }
    if (existing?.role === 'root')
      throw DataApiErrorFactory.resourceLocked('Message', messageId, 'the conversation root')
    const ownsPendingReply = tx
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(
        and(
          sql`json_extract(${sessionMessagesTable.data}, '$.deliveryReplyAnchor') = ${messageId}`,
          inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
        )
      )
      .limit(1)
      .get()
    if (existing?.inputContextId || existing?.nativeSessionId || ownsPendingReply) {
      throw DataApiErrorFactory.resourceLocked('Message', messageId, 'native input binding')
    }
    this.invalidateForkPrefixTx(tx, sessionId, messageId)
    if (existing) {
      agentSessionContextService.removeRootMessagesTx(tx, sessionId, [messageId])
      tx.update(sessionMessagesTable)
        .set({ parentId: existing.parentId })
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.parentId, messageId)))
        .run()
      tx.update(sessionTable)
        .set({ activeNodeId: existing.parentId })
        .where(and(eq(sessionTable.id, sessionId), eq(sessionTable.activeNodeId, messageId)))
        .run()
    }
    const result = tx
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
      .run()
    if (result.changes) {
      deleteMessageProvenanceTx(tx, sessionId, messageId)
      refreshImportedHistoryMessageCountTx(tx, sessionId)
    }
    return {
      rowsAffected: result.changes,
      hasLocalTurnUsage: existing?.localTurnUsageType === 'object',
      hasLocalSessionCost: existing?.localSessionCostType === 'object'
    }
  }

  /** Legacy orphans plus native agent types whose caller owns restart terminalization. */
  findCrashOrphanedAssistantMessages(nativeKinds: readonly AgentRuntimeLocator['kind'][] = []): Array<{
    id: string
    sessionId: string
    data: AgentSessionMessageEntity['data']
  }> {
    const database = application.get('DbService').getDb()
    const rows = database
      .select({
        id: sessionMessagesTable.id,
        sessionId: sessionMessagesTable.sessionId,
        data: sessionMessagesTable.data
      })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.role, 'assistant'),
          or(
            eq(sessionMessagesTable.status, 'pending'),
            sql<boolean>`exists (
              select 1 from agent_session_message_part as part
              where part.message_id = ${sessionMessagesTable.id}
                and json_extract(part.payload, '$.state') = 'approval-requested'
            )`
          ),
          canRepairAfterCrash(nativeKinds),
          sql`NOT EXISTS (
            SELECT 1 FROM agent_session_message AS delivery_message
            WHERE delivery_message.delivery_status = 'delivering'
              AND delivery_message.delivery_turn_ref = ${sessionMessagesTable.id}
          )`
        )
      )
      .all()
    return hydrateAgentSessionMessageRowsTx(database, attachAgentSessionMessagePartsTx(database, rows))
  }

  /**
   * Boot reconcile of crash-orphaned `pending` rows: resolve each row to `error` (with the
   * caller's terminalized `data`) and discard only legacy resume tokens, atomically.
   * A crashed turn leaves the external CLI session in an untrusted state — resuming it can replay
   * a runaway execution (#18281) — so the next connection must start without a token.
   */
  resolveCrashOrphanedMessages(
    messages: Array<{ id: string; data: AgentSessionMessageEntity['data'] }>,
    sessionIds: string[]
  ): void {
    if (messages.length === 0) return
    application.get('DbService').withWriteTx((tx) => {
      const updatedAt = Date.now()
      for (const message of messages) {
        const [existing] = attachAgentSessionMessagePartsTx(
          tx,
          tx
            .select({
              id: sessionMessagesTable.id,
              sessionId: sessionMessagesTable.sessionId,
              data: sessionMessagesTable.data
            })
            .from(sessionMessagesTable)
            .where(and(eq(sessionMessagesTable.id, message.id), eq(sessionMessagesTable.role, 'assistant')))
            .all()
        )
        if (!existing) continue
        const { storedData, offloaded, retainedToolCallIds } = this.extractMessageToolOutputs(
          existing.sessionId,
          message.id,
          message.data
        )
        const stored = splitAgentSessionMessageData(storedData)
        tx.update(sessionMessagesTable)
          .set({ status: 'error', data: stored.data, updatedAt })
          .where(and(eq(sessionMessagesTable.id, message.id), eq(sessionMessagesTable.role, 'assistant')))
          .run()
        replaceAgentSessionMessagePartsTx(tx, {
          sessionId: existing.sessionId,
          messageId: message.id,
          parts: stored.parts,
          timestampMs: updatedAt
        })
        syncMessageToolOutputsTx(
          tx,
          existing.sessionId,
          message.id,
          offloaded,
          retainedToolCallIds,
          existing.data,
          updatedAt
        )
      }
      if (sessionIds.length > 0) {
        tx.update(sessionMessagesTable)
          .set({ runtimeResumeToken: null })
          .where(
            and(
              inArray(sessionMessagesTable.sessionId, sessionIds),
              isNotNull(sessionMessagesTable.runtimeResumeToken),
              canRepairAfterCrash()
            )
          )
          .run()
      }
    })
  }

  /** Best-effort terminalization after a live assistant persistence failure. */
  markAssistantMessageTerminalError(sessionId: string, messageId: string): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      const result = tx
        .update(sessionMessagesTable)
        .set({ status: 'error', updatedAt: Date.now() })
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.role, 'assistant'),
            eq(sessionMessagesTable.status, 'pending')
          )
        )
        .run()
      return result
    })
    if (changed.changes > 0) this.publishDeliveryChange(sessionId, messageId, 'projection')
  }

  applyNativeFollowupEdit(
    sessionId: string,
    contextId: string,
    messageId: string,
    text: Extract<CherryMessagePart, { type: 'text' }>
  ): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      const row = this.findExistingMessageRow(tx, sessionId, messageId)
      if (row?.role !== 'user' || row.inputContextId !== contextId || row.delivery) return false
      const parts = [...(row.data.parts ?? [])]
      const index = parts.findIndex((part) => part.type === 'text')
      if (index < 0 || JSON.stringify(parts[index]) === JSON.stringify(text)) return false
      parts[index] = text
      const updatedAt = Date.now()
      this.invalidateForkPrefixTx(tx, sessionId, messageId)
      tx.update(sessionMessagesTable).set({ updatedAt }).where(eq(sessionMessagesTable.id, messageId)).run()
      replaceAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId,
        parts,
        partIds: readAgentSessionMessagePartIdsTx(tx, messageId),
        timestampMs: updatedAt
      })
      return true
    })
    if (changed) this.publishDeliveryChange(sessionId, messageId, 'projection')
  }

  /** A `paused` user message is one the runtime withdrew before the agent received it. */
  markUserMessageUnsent(sessionId: string, messageId: string, contextId?: string | null): void {
    const change = application.get('DbService').withWriteTx((tx) => {
      const changed = tx
        .update(sessionMessagesTable)
        .set({ status: 'paused', updatedAt: Date.now() })
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.role, 'user'),
            eq(sessionMessagesTable.status, 'success'),
            contextId
              ? and(
                  eq(sessionMessagesTable.inputContextId, contextId),
                  isNull(sessionMessagesTable.replyId),
                  isNull(sessionMessagesTable.deliveryStatus)
                )
              : contextId === null
                ? isNull(sessionMessagesTable.inputContextId)
                : undefined
          )
        )
        .run()
      if (!changed.changes) return
      return this.publishStagedFollowupTx(tx, sessionId, messageId, contextId ?? undefined)
        ? 'membership'
        : 'projection'
    })
    if (change) this.publishDeliveryChange(sessionId, messageId, change)
  }

  private rowToEntity(
    row: Omit<SessionMessageRow, 'data'> & {
      data: AgentSessionMessageData
      partIds?: string[]
      partPositions?: (number | null)[]
    }
  ): AgentSessionMessageEntity {
    const role =
      row.role === 'user' && row.provenance?.source === 'codex' && row.provenance.isSetup ? 'system' : row.role
    const formatted =
      row.provenance?.source === 'claude-code'
        ? presentClaudeHistory(row.data)
        : row.provenance?.source === 'codex'
          ? presentCodexHistory(row.data, role)
          : row.data
    const presented = row.provenance
      ? presentImportedTools(row.provenance.source, row.id, role, formatted, row.status)
      : { role, data: formatted }
    return {
      id: row.id,
      sessionId: row.sessionId,
      ...(row.partIds && { partIds: row.partIds, partPositions: row.partPositions }),
      role: presented.role as AgentSessionMessageEntity['role'],
      data: publicMessageData(presented.data),
      ...(row.provenance ? { provenance: row.provenance } : {}),
      searchableText: row.searchableText,
      status: row.status as AgentSessionMessageEntity['status'],
      modelId: row.modelId,
      messageSnapshot: row.messageSnapshot,
      stats: row.stats,
      runtimeResumeToken: row.runtimeResumeToken,
      pos: row.pos,
      replyId: row.replyId,
      delivery:
        row.delivery && row.deliveryStatus
          ? {
              ...row.delivery,
              status: row.deliveryStatus,
              inReplyTo: row.deliveryInReplyTo,
              turnRef: row.deliveryTurnRef
            }
          : null,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  getLastRuntimeResumeToken(sessionId: string, messageId?: string): string | null {
    const db = application.get('DbService').getDb()
    const head = messageId ?? getAgentSessionHead(db, sessionId)
    const context = head && agentSessionContextService.branchTx(db, sessionId, head)
    if (context && context.checkpointMapping?.referenceHistory)
      return context.bindingState === 'bound' ? context.nativeThreadId : null
    const path = this.nativePath(sessionId, head ?? undefined)
    for (const row of path.toReversed()) {
      if (row.runtimeResumeToken) return row.runtimeResumeToken
      if (row.nativeSessionId) {
        const context = agentSessionContextService.branchTx(db, sessionId, row.id)
        return context?.bindingState === 'bound' ? context.nativeThreadId : null
      }
    }
    return null
  }

  /**
   * Every resume token still claimed by a session row — the keep-set for the
   * agent orphan sweep. Trashed sessions are included (their message rows
   * survive), so a trashed session's runtime state is only reclaimed once the
   * session is purged and the FK cascade drops its tokens.
   */
  listAllRuntimeResumeTokens(): Set<string> {
    const rows = application
      .get('DbService')
      .getDb()
      .selectDistinct({ runtimeResumeToken: sessionMessagesTable.runtimeResumeToken })
      .from(sessionMessagesTable)
      .where(isNotNull(sessionMessagesTable.runtimeResumeToken))
      .all()
    const bindings = application
      .get('DbService')
      .getDb()
      .select({ nativeThreadId: agentSessionContextTable.nativeThreadId })
      .from(agentSessionContextTable)
      .where(isNotNull(agentSessionContextTable.nativeThreadId))
      .all()
    return new Set([
      ...rows.flatMap((row) => (row.runtimeResumeToken ? [row.runtimeResumeToken] : [])),
      ...bindings.flatMap((row) => (row.nativeThreadId ? [row.nativeThreadId] : []))
    ])
  }

  listRuntimeResumeTokensBySession(sessionIds: readonly string[]): Map<string, Set<string>> {
    const tokensBySession = new Map<string, Set<string>>()
    if (sessionIds.length === 0) return tokensBySession
    const db = application.get('DbService').getDb()
    const owners = [
      ...new Map(
        chunk([...sessionIds], SQLITE_INARRAY_CHUNK)
          .flatMap((idChunk) =>
            db
              .select({ id: sessionTable.id, owner: sessionTable.ownerSessionId })
              .from(sessionTable)
              .where(or(inArray(sessionTable.id, idChunk), inArray(sessionTable.ownerSessionId, idChunk)))
              .all()
          )
          .map((row) => [row.id, row] as const)
      ).values()
    ]
    if (!owners.length) return tokensBySession
    const requested = new Set(sessionIds)
    const destinations = new Map(
      owners.map(({ id, owner }) => [id, [id, owner].filter((key): key is string => !!key && requested.has(key))])
    )
    const collect = (sessionId: string, token: string | null) => {
      if (!token) return
      for (const owner of destinations.get(sessionId) ?? []) {
        const tokens = tokensBySession.get(owner) ?? new Set<string>()
        tokens.add(token)
        tokensBySession.set(owner, tokens)
      }
    }
    for (const idChunk of chunk(
      owners.map(({ id }) => id),
      SQLITE_INARRAY_CHUNK
    )) {
      const rows = db
        .selectDistinct({
          sessionId: sessionMessagesTable.sessionId,
          runtimeResumeToken: sessionMessagesTable.runtimeResumeToken
        })
        .from(sessionMessagesTable)
        .where(
          and(inArray(sessionMessagesTable.sessionId, idChunk), isNotNull(sessionMessagesTable.runtimeResumeToken))
        )
        .all()
      for (const row of rows) collect(row.sessionId, row.runtimeResumeToken)
      const bindings = db
        .select({
          sessionId: agentSessionContextTable.sessionId,
          nativeThreadId: agentSessionContextTable.nativeThreadId
        })
        .from(agentSessionContextTable)
        .where(inArray(agentSessionContextTable.sessionId, idChunk))
        .all()
      for (const binding of bindings) {
        collect(binding.sessionId, binding.nativeThreadId)
      }
    }
    return tokensBySession
  }

  // ── Persistence methods ──────────────────────────────────────────

  private assertActiveSession(db: DbOrTx, sessionId: string): void {
    const [session] = db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, sessionId), isNull(sessionTable.deletedAt)))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)
  }

  private findExistingMessageRow(
    db: DbOrTx,
    sessionId: string,
    messageId: string,
    includePartIds = false
  ): SessionMessage | null {
    const rows = db
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, messageId)))
      .limit(1)
      .all()

    return attachAgentSessionMessagePartsTx(db, rows, includePartIds)[0] ?? null
  }

  private withParts(db: DbOrTx, row: SessionMessageRow): SessionMessage {
    return attachAgentSessionMessagePartsTx(db, [row])[0]
  }

  private upsertMessage(
    db: DbOrTx,
    params: SaveAgentSessionMessageParams,
    timestampMs = Date.now()
  ): SavedAgentSessionMessage {
    const { sessionId, runtimeResumeToken = null, runtimeStats, message } = params
    const messageId = message.id ?? uuidv7()
    const status = message.status ?? 'success'

    if (!message.role) {
      throw DataApiErrorFactory.validation({ role: ['is required'] }, 'Message payload missing role')
    }

    if (!isUuid(messageId)) {
      throw DataApiErrorFactory.validation({ id: ['must be a UUID'] }, 'Agent session message id must be a UUID')
    }

    const existingRow = this.findExistingMessageRow(db, sessionId, messageId)
    const data: AgentSessionMessageData = publicMessageData(message.data)
    delete data.localTurnUsage
    if (params.localTurnUsage ?? existingRow?.data.localTurnUsage)
      data.localTurnUsage = params.localTurnUsage ?? existingRow?.data.localTurnUsage
    delete data.localSessionCost
    const sessionCost = params.localSessionCost ?? existingRow?.data.localSessionCost
    if (sessionCost) data.localSessionCost = sessionCost
    if (params.runtimeAnchor) data.runtimeAnchor = params.runtimeAnchor
    if (params.deliveryReplyAnchor) data.deliveryReplyAnchor = params.deliveryReplyAnchor

    if (existingRow) {
      if (existingRow.data.deliveryReplyAnchor) data.deliveryReplyAnchor = existingRow.data.deliveryReplyAnchor
      if (existingRow.data.nativeSessionId) data.nativeSessionId = existingRow.data.nativeSessionId
      if (existingRow.data.nativePlaced) data.nativePlaced = true
      if (existingRow.data.locallyHandled) data.locallyHandled = true
      if (existingRow.data.stagedFollowup) data.stagedFollowup = true
      const { storedData, offloaded, retainedToolCallIds, hasDeferredInput } = this.extractMessageToolOutputs(
        sessionId,
        messageId,
        data,
        params.unchangedToolCallIds
      )
      if (
        existingRow.inputContextId &&
        (JSON.stringify(existingRow.data.parts) !== JSON.stringify(storedData.parts) ||
          message.role !== existingRow.role)
      ) {
        throw DataApiErrorFactory.resourceLocked('Message', messageId, 'native input binding')
      }
      const runtimeResumeTokenToPersist = runtimeResumeToken ?? existingRow.runtimeResumeToken ?? null
      const updatedAtMs = timestampMs
      const modelId = message.modelId === undefined ? existingRow.modelId : message.modelId
      const messageSnapshot =
        message.messageSnapshot === undefined ? existingRow.messageSnapshot : message.messageSnapshot
      const stats = mergeMessageRuntimeStats(existingRow.stats, runtimeStats) ?? null
      const delivery = message.delivery === undefined ? existingRow.delivery : message.delivery
      const deliveryStatus = message.deliveryStatus === undefined ? existingRow.deliveryStatus : message.deliveryStatus
      const deliveryTurnRef =
        message.deliveryTurnRef === undefined ? existingRow.deliveryTurnRef : message.deliveryTurnRef
      const deliveryInReplyTo =
        message.deliveryInReplyTo === undefined ? existingRow.deliveryInReplyTo : message.deliveryInReplyTo
      const deliverySenderSessionId =
        message.deliverySenderSessionId === undefined
          ? existingRow.deliverySenderSessionId
          : message.deliverySenderSessionId
      const activityTimestamp = isAssistantActivityTransition({
        existingStatus: existingRow.status,
        role: message.role,
        status
      })
        ? timestampMs
        : null

      const stored = splitAgentSessionMessageData(storedData)
      withSqliteErrors(
        () =>
          db
            .update(sessionMessagesTable)
            .set({
              role: message.role,
              status,
              data: stored.data,
              modelId,
              messageSnapshot,
              stats,
              runtimeResumeToken: runtimeResumeTokenToPersist,
              delivery,
              deliveryStatus,
              deliveryTurnRef,
              deliveryInReplyTo,
              deliverySenderSessionId,
              updatedAt: updatedAtMs
            })
            .where(eq(sessionMessagesTable.id, existingRow.id))
            .run(),
        defaultHandlersFor('Message', String(existingRow.id))
      )
      replaceAgentSessionMessagePartsTx(db, {
        sessionId,
        messageId: existingRow.id,
        parts: stored.parts,
        partIds: params.partIds,
        positions: params.positions,
        timestampMs: updatedAtMs
      })
      syncMessageToolOutputsTx(
        db,
        sessionId,
        existingRow.id,
        offloaded,
        retainedToolCallIds,
        existingRow.data,
        updatedAtMs
      )
      replaceAgentSessionMessageFileRefsTx(db, existingRow.id, message.data)

      return {
        entity: this.rowToEntity({
          ...existingRow,
          role: message.role,
          status,
          data: hasDeferredInput ? hydrateAgentSessionMessageDataTx(db, existingRow.id, data) : data,
          searchableText: existingRow.searchableText,
          modelId,
          messageSnapshot,
          stats,
          runtimeResumeToken: runtimeResumeTokenToPersist,
          delivery,
          deliveryStatus,
          deliveryTurnRef,
          deliveryInReplyTo,
          deliverySenderSessionId,
          updatedAt: updatedAtMs
        }),
        dataChange: 'projection',
        activityTimestamp
      }
    }

    const parentId = params.parentId ?? getAgentSessionHead(db, sessionId) ?? ensureAgentSessionRootTx(db, sessionId)
    validateAgentSessionParent(db, sessionId, parentId)
    const { storedData, offloaded, retainedToolCallIds, hasDeferredInput } = this.extractMessageToolOutputs(
      sessionId,
      messageId,
      data
    )
    const stored = splitAgentSessionMessageData(storedData)
    const insertData: InsertSessionMessageRow = {
      parentId,
      id: messageId,
      sessionId,
      role: message.role,
      status,
      data: params.stageFollowup ? { ...stored.data, stagedFollowup: true } : stored.data,
      modelId: message.modelId,
      messageSnapshot: message.messageSnapshot,
      stats: mergeMessageRuntimeStats(undefined, runtimeStats) ?? null,
      runtimeResumeToken,
      delivery: message.delivery,
      deliveryStatus: message.deliveryStatus,
      deliveryTurnRef: message.deliveryTurnRef,
      deliveryInReplyTo: message.deliveryInReplyTo,
      deliverySenderSessionId: message.deliverySenderSessionId,
      createdAt: timestampMs,
      updatedAt: timestampMs
    }

    const [saved] = db.insert(sessionMessagesTable).values(insertData).returning().all()
    replaceAgentSessionMessagePartsTx(db, {
      sessionId,
      messageId: saved.id,
      parts: stored.parts,
      partIds: params.partIds,
      positions: params.positions,
      timestampMs
    })
    syncMessageToolOutputsTx(db, sessionId, saved.id, offloaded, retainedToolCallIds, undefined, timestampMs)
    replaceAgentSessionMessageFileRefsTx(db, saved.id, message.data)
    if (!params.stageFollowup) advanceAgentSessionHeadTx(db, sessionId, parentId, saved.id)
    return {
      entity: this.rowToEntity({
        ...saved,
        data: hasDeferredInput ? hydrateAgentSessionMessageDataTx(db, saved.id, data) : data
      }),
      dataChange: 'membership',
      activityTimestamp: !params.stageFollowup && isConversationActivityRole(message.role) ? timestampMs : null
    }
  }

  private saveMessageTx(
    db: DbOrTx,
    params: SaveAgentSessionMessageParams,
    timestampMs = Date.now()
  ): SavedAgentSessionMessage {
    const result = this.upsertMessage(db, params, timestampMs)
    if (params.nativeContextId && params.runtimeResumeToken) {
      agentSessionContextService.confirmBranchTx(
        db,
        params.nativeContextId,
        params.sessionId,
        result.entity.id,
        params.runtimeResumeToken
      )
    }
    agentSessionService.touchUpdatedAtTx(db, params.sessionId, timestampMs)
    if (result.activityTimestamp !== null) {
      agentSessionService.advanceLastActivityAtTx(db, params.sessionId, result.activityTimestamp)
    }
    return result
  }

  saveMessage(
    params: SaveAgentSessionMessageParams,
    options: SaveAgentSessionMessageOptions = {}
  ): AgentSessionMessageEntity {
    const { db, publishDataChange } = options
    const timestampMs = Date.now()
    const persist = (tx: DbOrTx) => {
      const saved = this.saveMessageTx(tx, params, timestampMs)
      if (options.projection) agentSessionContextService.saveRootProjectionTx(tx, params.sessionId, options.projection)
      return saved
    }
    if (db) return persist(db).entity
    const result = application.get('DbService').withWriteTx(persist)
    if (!params.stageFollowup) this.publishSavedMessage(params.sessionId, result, publishDataChange)
    return result.entity
  }

  private publishSavedMessage(sessionId: string, result: SavedAgentSessionMessage, publishDataChange?: boolean): void {
    if (result.entity.role === 'assistant') {
      aiUsageRecordService.refreshMessageProjection(
        { kind: 'agent-session', id: result.entity.id },
        { publishDataChange: !publishDataChange }
      )
    }
    if (result.activityTimestamp !== null && !publishDataChange) {
      agentSessionService.notifyReadModelChange([sessionId], 'projection')
    }
    if (publishDataChange) {
      notifyDataApiDataChange([
        ...(result.entity.data.localTurnUsage || result.entity.data.localSessionCost
          ? [{ endpoint: '/ai-usage-records/local' as const, kind: 'membership' as const }]
          : []),
        ...(result.entity.data.localSessionCost
          ? [{ endpoint: '/agent-sessions/:sessionId/cost' as const, routeParams: { sessionId } }]
          : []),
        ...agentSessionReadModelEffects(result.activityTimestamp !== null ? [sessionId] : [], 'projection'),
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: result.dataChange,
          routeParams: { sessionId: sessionId },
          entityIds: [result.entity.id]
        },
        { endpoint: '/agent-sessions/:sessionId/messages/:messageId', entityIds: [result.entity.id] }
      ])
    }
  }

  readImportedHistory(sessionId: string, db: DbOrTx = application.get('DbService').getDb()) {
    const session = db
      .select({ session: sessionTable, workspace: agentWorkspaceTable, agent: agentTable })
      .from(sessionTable)
      .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, sessionTable.workspaceId))
      .innerJoin(agentTable, eq(agentTable.id, sessionTable.agentId))
      .where(and(eq(sessionTable.id, sessionId), isNull(sessionTable.deletedAt), isNull(agentTable.deletedAt)))
      .get()
    if (!session || session.agent.type !== 'pi') throw new Error('target_changed')
    const messages = readAgentSessionPath(db, sessionId)
    return { ...session, messages }
  }

  setImportedAnchorsTx(tx: DbOrTx, sessionId: string, anchors: ReadonlyMap<string, unknown>): void {
    for (const [id, anchor] of anchors) {
      const row = tx
        .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.id, id), eq(sessionMessagesTable.sessionId, sessionId)))
        .get()
      if (!row) throw new Error('source_changed')
      tx.update(sessionMessagesTable)
        .set({ data: { ...row.data, runtimeAnchor: anchor }, updatedAt: row.updatedAt })
        .where(eq(sessionMessagesTable.id, id))
        .run()
    }
  }

  importMessagesTx(
    tx: DbOrTx,
    sessionId: string,
    rows: readonly (Omit<InsertSessionMessageRow, 'sessionId' | 'data'> & {
      id: string
      updatedAt: number
      data: AgentSessionMessageData
      provenance: MessageProvenance
    })[]
  ): void {
    if (this.hasSessionMessages(sessionId)) throw new Error('session_not_empty')
    let parentId = ensureAgentSessionRootTx(tx, sessionId)
    for (const { provenance, ...row } of rows) {
      const { data, parts } = splitAgentSessionMessageData(row.data)
      tx.insert(sessionMessagesTable)
        .values({ ...row, data, sessionId, parentId })
        .run()
      replaceAgentSessionMessagePartsTx(tx, { sessionId, messageId: row.id, parts, timestampMs: row.updatedAt })
      setMessageProvenanceTx(tx, sessionId, row.id, provenance)
      advanceAgentSessionHeadTx(tx, sessionId, parentId, row.id)
      parentId = row.id
    }
  }

  /** Reconciles a child archive's proven source order without editing a product conversation branch. */
  orderChildArchiveTx(tx: DbOrTx, sessionId: string, order: readonly string[], removed: readonly string[] = []): void {
    const session = tx.select().from(sessionTable).where(eq(sessionTable.id, sessionId)).get()
    if (!session?.ownerSessionId) throw new Error('Only owned child archives can reconcile message order')
    const rows = tx
      .select({ id: sessionMessagesTable.id, parentId: sessionMessagesTable.parentId, role: sessionMessagesTable.role })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.sessionId, sessionId))
      .all()
    const byId = new Map(rows.filter((row) => row.role !== 'root').map((row) => [row.id, row]))
    const priorPath = new Set(
      readAgentSessionAncestry(tx, sessionId, session.activeNodeId ?? ensureAgentSessionRootTx(tx, sessionId)).map(
        (row) => row.id
      )
    )
    const ordered = new Set(order)
    const removedIds = new Set(removed)
    if (
      ordered.size !== order.length ||
      order.some((id) => !byId.has(id)) ||
      [...priorPath].some((id) => byId.has(id) && !ordered.has(id) && !removedIds.has(id))
    )
      throw new Error('Child archive order must retain messages without explicit removal')
    let parentId = ensureAgentSessionRootTx(tx, sessionId)
    for (const id of order) {
      if (byId.get(id)!.parentId !== parentId)
        tx.update(sessionMessagesTable).set({ parentId }).where(eq(sessionMessagesTable.id, id)).run()
      parentId = id
    }
    tx.update(sessionTable).set({ activeNodeId: parentId }).where(eq(sessionTable.id, sessionId)).run()
  }

  saveMessagesTx(
    tx: DbOrTx,
    params: CreateAgentSessionMessagesDto & {
      parentId?: string
      unchangedToolCallIds?: ReadonlyMap<string, ReadonlySet<string>>
      partIdsByMessage?: ReadonlyMap<string, readonly string[]>
    },
    expectedAgent?: string | { id: string; updatedAt: string; model: string | null; type: string }
  ): AgentSessionMessageEntity[] {
    const { sessionId, runtimeResumeToken, messages } = params
    this.assertExpectedAgentTx(tx, sessionId, expectedAgent)
    const timestampMs = Date.now()
    let parentId = params.parentId
    const saved = messages.map((message, index) => {
      const result = this.upsertMessage(
        tx,
        {
          sessionId,
          runtimeResumeToken,
          message,
          parentId,
          unchangedToolCallIds: message.id ? params.unchangedToolCallIds?.get(message.id) : undefined,
          partIds: message.id ? params.partIdsByMessage?.get(message.id) : undefined
        },
        timestampMs
      )
      if (index < messages.length - 1) parentId = this.branchTip(sessionId, result.entity.id, tx)
      return result
    })
    const activityTimestamp = saved.reduce<number | null>(
      (latest, result) =>
        result.activityTimestamp === null
          ? latest
          : latest === null
            ? result.activityTimestamp
            : Math.max(latest, result.activityTimestamp),
      null
    )
    agentSessionService.touchUpdatedAtTx(tx, sessionId, timestampMs)
    if (activityTimestamp !== null) {
      agentSessionService.advanceLastActivityAtTx(tx, sessionId, activityTimestamp)
    }
    return saved.map((result) => result.entity)
  }

  /**
   * Persist one cross-session user message and its trusted sender/receiver envelope atomically.
   * The caller supplies only its runtime-bound identity; both addresses are re-read in this
   * transaction so a stale or forged tool context cannot impersonate another Session.
   */
  acceptSessionDelivery(input: {
    senderAgentId: string
    senderSessionId: string
    senderMessageId?: string
    receiverSessionId: string
    content: string
    replyPolicy?: AgentSessionDeliveryReplyPolicy
  }): AgentSessionMessageEntity {
    const content = input.content.trim()
    if (!content) throw DataApiErrorFactory.validation({ content: ['must not be empty'] })

    const saved = application
      .get('DbService')
      .withWriteTx((tx) => this.acceptSessionDeliveryTx(tx, { ...input, content }))

    this.publishDeliveryMutation(
      [{ sessionId: saved.sessionId, messageId: saved.id, kind: 'membership' }],
      [saved.sessionId]
    )
    return saved
  }

  /** Atomically create a Session and persist its first durable delivery. */
  createSessionWithDelivery(input: {
    delegation?: true
    senderAgentId: string
    senderSessionId: string
    senderMessageId?: string
    targetAgentId?: string
    sessionName: string
    workspace: AgentSessionWorkspaceSource
    content: string
  }): { session: AgentSessionEntity; message: AgentSessionMessageEntity } {
    const content = input.content.trim()
    if (!content) throw DataApiErrorFactory.validation({ content: ['must not be empty'] })

    const sessionId = uuidv4()
    const message = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          agentSessionService.createTx(tx, sessionId, {
            agentId: input.targetAgentId ?? input.senderAgentId,
            name: input.sessionName,
            workspace: input.workspace
          })
          return this.acceptSessionDeliveryTx(tx, {
            senderAgentId: input.senderAgentId,
            senderSessionId: input.senderSessionId,
            senderMessageId: input.senderMessageId,
            receiverSessionId: sessionId,
            content,
            replyPolicy: 'completion',
            ...(input.delegation ? { delegation: true as const } : {})
          })
        }),
      {
        ...defaultHandlersFor('Session', sessionId),
        foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
      }
    )

    const session = agentSessionService.getById(sessionId)
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [sessionId] },
      ...(input.workspace.type === 'system'
        ? [{ endpoint: '/agent-workspaces' as const, kind: 'membership' as const, entityIds: [session.workspaceId] }]
        : []),
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', entityIds: [message.id] }
    ])
    return { session, message }
  }

  private acceptSessionDeliveryTx(
    tx: DbOrTx,
    input: {
      delegation?: true
      senderAgentId: string
      senderSessionId: string
      senderMessageId?: string
      receiverSessionId: string
      content: string
      replyPolicy?: AgentSessionDeliveryReplyPolicy
    }
  ): AgentSessionMessageEntity {
    const [sender] = tx
      .select({ agentId: sessionTable.agentId, agentName: agentTable.name, sessionName: sessionTable.name })
      .from(sessionTable)
      .leftJoin(agentTable, and(eq(sessionTable.agentId, agentTable.id), isNull(agentTable.deletedAt)))
      .where(and(eq(sessionTable.id, input.senderSessionId), isNull(sessionTable.deletedAt)))
      .limit(1)
      .all()
    if (!sender || sender.agentId !== input.senderAgentId || sender.agentName === null) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.SENDER_FORBIDDEN,
        'The active runtime no longer owns the sender Session'
      )
    }

    const [receiverSession] = tx
      .select({ agentId: sessionTable.agentId, sessionName: sessionTable.name })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, input.receiverSessionId), isNull(sessionTable.deletedAt)))
      .limit(1)
      .all()
    if (!receiverSession) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_SESSION_NOT_FOUND,
        `Target Session not found: ${input.receiverSessionId}`
      )
    }
    if (!receiverSession.agentId) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_SESSION_ORPHANED,
        `Target Session has no Agent: ${input.receiverSessionId}`
      )
    }
    const [receiverAgent] = tx
      .select({ name: agentTable.name })
      .from(agentTable)
      .where(and(eq(agentTable.id, receiverSession.agentId), isNull(agentTable.deletedAt)))
      .limit(1)
      .all()
    if (!receiverAgent) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_AGENT_DELETED,
        `Target Agent is deleted: ${receiverSession.agentId}`
      )
    }

    const id = uuidv7()
    const statusAt = new Date().toISOString()
    const senderIdentity = {
      agentId: input.senderAgentId,
      sessionId: input.senderSessionId
    }
    const delivery: AgentSessionDeliveryEnvelope = {
      version: 1,
      ...(input.delegation ? { delegation: true } : {}),
      sender: senderIdentity,
      receiver: {
        agentId: receiverSession.agentId,
        sessionId: input.receiverSessionId
      },
      senderSnapshot: {
        agentName: sender.agentName,
        sessionName: sender.sessionName
      },
      receiverSnapshot: {
        agentName: receiverAgent.name,
        sessionName: receiverSession.sessionName
      },
      replyPolicy: input.replyPolicy ?? 'none',
      sourceMessageId: null,
      outcome: null,
      error: null,
      statusAt
    }

    const replyAnchor =
      input.senderMessageId ??
      getAgentSessionHead(tx, input.senderSessionId) ??
      ensureAgentSessionRootTx(tx, input.senderSessionId)
    validateAgentSessionParent(tx, input.senderSessionId, replyAnchor)
    return this.saveMessageTx(tx, {
      sessionId: input.receiverSessionId,
      deliveryReplyAnchor: replyAnchor,
      message: {
        id,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: input.content }] },
        delivery,
        deliveryStatus: 'accepted',
        deliveryInReplyTo: null,
        deliverySenderSessionId: senderIdentity.sessionId
      }
    }).entity
  }

  listRecoverableSessionDeliveries(sessionId?: string): AgentSessionMessageEntity[] {
    const filters = [inArray(sessionMessagesTable.deliveryStatus, [...AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES])]
    if (sessionId) filters.push(eq(sessionMessagesTable.sessionId, sessionId))
    return application
      .get('DbService')
      .getDb()
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(sessionMessagesTable.createdAt, sessionMessagesTable.id)
      .all()
      .map((row) => this.rowToEntity(this.withParts(application.get('DbService').getDb(), row)))
  }

  listAcceptedSessionDeliveries(sessionId?: string): AgentSessionMessageEntity[] {
    const filters = [eq(sessionMessagesTable.deliveryStatus, 'accepted')]
    if (sessionId) filters.push(eq(sessionMessagesTable.sessionId, sessionId))
    return application
      .get('DbService')
      .getDb()
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(sessionMessagesTable.createdAt, sessionMessagesTable.id)
      .all()
      .map((row) => this.rowToEntity(this.withParts(application.get('DbService').getDb(), row)))
  }

  findDeliveringSessionDeliveryByTurnRef(turnRef: string): AgentSessionMessageEntity | null {
    const row = application
      .get('DbService')
      .getDb()
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(
        and(eq(sessionMessagesTable.deliveryStatus, 'delivering'), eq(sessionMessagesTable.deliveryTurnRef, turnRef))
      )
      .limit(1)
      .get()
    return row ? this.rowToEntity(this.withParts(application.get('DbService').getDb(), row)) : null
  }

  publishDeliveryChanges(messages: readonly AgentSessionMessageEntity[]): void {
    this.publishDeliveryMutation(
      messages.map((message) => ({
        sessionId: message.sessionId,
        messageId: message.id,
        kind: 'membership' as const
      })),
      messages.map((message) => message.sessionId)
    )
  }

  /** Publish a delivery claim's existing request projection and new assistant placeholder. */
  publishDispatchChanges(sessionId: string, messages: readonly AgentSessionMessageEntity[]): void {
    if (messages.length === 0) return
    this.publishDeliveryMutation(
      messages.map((message, index) => ({
        sessionId,
        messageId: message.id,
        kind: index === 0 ? ('projection' as const) : ('membership' as const)
      })),
      [sessionId]
    )
  }

  listSessionDeliveries(
    input:
      | string
      | {
          sessionId: string
          direction?: 'incoming' | 'outgoing'
          requestId?: string
          status?: AgentSessionDeliveryStatus
          limit?: number
        },
    legacyLimit?: number
  ): AgentSessionMessageEntity[] {
    const query = typeof input === 'string' ? { sessionId: input, limit: legacyLimit } : input
    const filters = [isNotNull(sessionMessagesTable.delivery)]
    if (query.requestId) {
      filters.push(
        or(eq(sessionMessagesTable.id, query.requestId), eq(sessionMessagesTable.deliveryInReplyTo, query.requestId))!
      )
    }
    if (query.status) filters.push(eq(sessionMessagesTable.deliveryStatus, query.status))
    if (query.requestId) {
      filters.push(
        or(
          eq(sessionMessagesTable.sessionId, query.sessionId),
          eq(sessionMessagesTable.deliverySenderSessionId, query.sessionId)
        )!
      )
    } else if (query.direction === 'outgoing') {
      filters.push(eq(sessionMessagesTable.deliverySenderSessionId, query.sessionId))
    } else {
      filters.push(eq(sessionMessagesTable.sessionId, query.sessionId))
    }

    return application
      .get('DbService')
      .getDb()
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .limit(Math.min(Math.max(query.limit ?? 20, 1), 100))
      .all()
      .map((row) => this.rowToEntity(this.withParts(application.get('DbService').getDb(), row)))
  }

  transitionSessionDelivery(
    sessionId: string,
    messageId: string,
    status: AgentSessionDeliveryStatus,
    options: {
      expected?: AgentSessionDeliveryStatus[]
      turnRef?: string | null
      outcome?: AgentSessionDeliveryOutcome | null
      error?: AgentSessionDeliveryError | null
    } = {}
  ): AgentSessionMessageEntity | null {
    const updated = application.get('DbService').withWriteTx((tx) => {
      const existing = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existing?.delivery || !existing.deliveryStatus) return null
      if (options.expected && !options.expected.includes(existing.deliveryStatus)) return null
      if (existing.deliveryStatus === 'consumed' || existing.deliveryStatus === 'failed') {
        return this.rowToEntity(existing)
      }

      const delivery: AgentSessionDeliveryEnvelope = {
        ...existing.delivery,
        ...(options.outcome !== undefined ? { outcome: options.outcome } : {}),
        ...(options.error !== undefined ? { error: options.error } : {}),
        statusAt: new Date().toISOString()
      }
      const [row] = tx
        .update(sessionMessagesTable)
        .set({
          delivery,
          deliveryStatus: status,
          deliveryTurnRef: status === 'delivering' ? (options.turnRef ?? existing.deliveryTurnRef) : null
        })
        .where(
          and(
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.sessionId, sessionId),
            ...(options.expected ? [inArray(sessionMessagesTable.deliveryStatus, options.expected)] : [])
          )
        )
        .returning()
        .all()
      return row ? this.rowToEntity(this.withParts(tx, row)) : null
    })
    if (updated) this.publishDeliveryChange(sessionId, messageId, 'projection')
    return updated
  }

  claimSessionDeliveryTx(
    tx: DbOrTx,
    sessionId: string,
    messageId: string,
    turnRef: string
  ): AgentSessionMessageEntity | null {
    const existing = this.findExistingMessageRow(tx, sessionId, messageId)
    if (!existing?.delivery || existing.deliveryStatus !== 'accepted') return null
    const delivery = { ...existing.delivery, statusAt: new Date().toISOString() }
    const row = tx
      .update(sessionMessagesTable)
      .set({ delivery, deliveryStatus: 'delivering', deliveryTurnRef: turnRef })
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.deliveryStatus, 'accepted')
        )
      )
      .returning()
      .get()
    return row ? this.rowToEntity(this.withParts(tx, row)) : null
  }

  finalizeSessionDelivery(input: {
    requestSessionId: string
    requestMessageId: string
    assistantMessageId: string
    outcome: AgentSessionDeliveryOutcome
  }): AgentSessionMessageEntity | null {
    const finalized = application.get('DbService').withWriteTx((tx) => {
      const request = this.findExistingMessageRow(tx, input.requestSessionId, input.requestMessageId)
      if (!request?.delivery || !request.deliveryStatus) return { requestId: null, result: null }

      if (request.deliveryStatus !== 'delivering' || request.deliveryTurnRef !== input.assistantMessageId) {
        return { requestId: null, result: null }
      }

      let error = request.delivery.delegation ? request.delivery.error : null
      const outcome = error?.code === 'TIMEOUT' ? 'failed' : input.outcome

      const existingResult = tx
        .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .get()
      if (existingResult) {
        tx.update(sessionMessagesTable)
          .set({
            deliveryStatus: 'consumed',
            deliveryTurnRef: null,
            delivery: { ...request.delivery, outcome, error, statusAt: new Date().toISOString() }
          })
          .where(eq(sessionMessagesTable.id, request.id))
          .run()
        return {
          requestId: request.id,
          result:
            existingResult.deliveryStatus === 'accepted' ? this.rowToEntity(this.withParts(tx, existingResult)) : null
        }
      }

      const assistant = this.findExistingMessageRow(tx, input.requestSessionId, input.assistantMessageId)
      if (!assistant || assistant.role !== 'assistant' || assistant.status === 'pending') {
        return { requestId: null, result: null }
      }

      if (!error && outcome === 'failed') {
        const failure = assistant.data.parts?.findLast((part) => part.type === 'data-error')
        const message = failure?.type === 'data-error' ? getSafeProviderErrorMessage(failure.data) : ''
        if (message) error = { code: 'TARGET_EXECUTION_FAILED', message }
      }

      let result: AgentSessionMessageEntity | null = null
      if (request.delivery.replyPolicy === 'completion') {
        const callerExists = tx
          .select({ id: sessionTable.id })
          .from(sessionTable)
          .where(and(eq(sessionTable.id, request.delivery.sender.sessionId), isNull(sessionTable.deletedAt)))
          .limit(1)
          .all()[0]
        if (!callerExists) {
          tx.update(sessionMessagesTable)
            .set({
              deliveryStatus: 'failed',
              deliveryTurnRef: null,
              delivery: {
                ...request.delivery,
                outcome: 'failed',
                error: { code: 'CALLER_SESSION_DELETED', message: 'Caller Session was deleted' },
                statusAt: new Date().toISOString()
              }
            })
            .where(eq(sessionMessagesTable.id, request.id))
            .run()
          return { requestId: request.id, result: null }
        }
        const resultEnvelope: AgentSessionDeliveryEnvelope = {
          version: 1,
          sender: request.delivery.receiver,
          receiver: request.delivery.sender,
          senderSnapshot: request.delivery.receiverSnapshot,
          receiverSnapshot: request.delivery.senderSnapshot,
          replyPolicy: 'none',
          sourceMessageId: assistant.id,
          outcome,
          error,
          statusAt: new Date().toISOString()
        }
        result = this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          parentId: request.data.deliveryReplyAnchor
            ? this.branchTip(request.delivery.sender.sessionId, request.data.deliveryReplyAnchor, tx)
            : undefined,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: terminalResultData(assistant, outcome, error ?? undefined),
            delivery: resultEnvelope,
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      }

      tx.update(sessionMessagesTable)
        .set({
          deliveryStatus: 'consumed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome, error, statusAt: new Date().toISOString() }
        })
        .where(eq(sessionMessagesTable.id, request.id))
        .run()
      return { requestId: request.id, result }
    })

    this.publishDeliveryMutation(
      [
        ...(finalized.requestId
          ? [{ sessionId: input.requestSessionId, messageId: finalized.requestId, kind: 'projection' as const }]
          : []),
        ...(finalized.result
          ? [{ sessionId: finalized.result.sessionId, messageId: finalized.result.id, kind: 'membership' as const }]
          : [])
      ],
      finalized.result ? [finalized.result.sessionId] : []
    )
    return finalized.result
  }

  failSessionDelivery(
    message: AgentSessionMessageEntity,
    error: AgentSessionDeliveryError
  ): AgentSessionMessageEntity | null {
    const failed = application.get('DbService').withWriteTx((tx) => {
      const request = this.findExistingMessageRow(tx, message.sessionId, message.id)
      if (!request?.delivery || !request.deliveryStatus) return { requestId: null, result: null }
      const now = new Date().toISOString()
      let result: AgentSessionMessageEntity | null = null
      if (request.delivery.replyPolicy === 'completion') {
        const callerExists = tx
          .select({ id: sessionTable.id })
          .from(sessionTable)
          .where(and(eq(sessionTable.id, request.delivery.sender.sessionId), isNull(sessionTable.deletedAt)))
          .limit(1)
          .all()[0]
        const existingResult = tx
          .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
          .from(sessionMessagesTable)
          .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
          .limit(1)
          .get()
        result = !callerExists
          ? null
          : existingResult
            ? existingResult.deliveryStatus === 'accepted'
              ? this.rowToEntity(this.withParts(tx, existingResult))
              : null
            : this.saveMessageTx(tx, {
                sessionId: request.delivery.sender.sessionId,
                parentId: request.data.deliveryReplyAnchor
                  ? this.branchTip(request.delivery.sender.sessionId, request.data.deliveryReplyAnchor, tx)
                  : undefined,
                message: {
                  id: uuidv7(),
                  role: 'user',
                  status: 'success',
                  data: terminalResultData(null, 'failed', error),
                  delivery: {
                    version: 1,
                    sender: request.delivery.receiver,
                    receiver: request.delivery.sender,
                    senderSnapshot: request.delivery.receiverSnapshot,
                    receiverSnapshot: request.delivery.senderSnapshot,
                    replyPolicy: 'none',
                    sourceMessageId: null,
                    outcome: 'failed',
                    error,
                    statusAt: now
                  },
                  deliveryStatus: 'accepted',
                  deliveryInReplyTo: request.id,
                  deliverySenderSessionId: request.delivery.receiver.sessionId
                }
              }).entity
      }
      tx.update(sessionMessagesTable)
        .set({
          deliveryStatus: 'failed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: 'failed', error, statusAt: now }
        })
        .where(eq(sessionMessagesTable.id, request.id))
        .run()
      return { requestId: request.id, result }
    })
    this.publishDeliveryMutation(
      [
        ...(failed.requestId
          ? [{ sessionId: message.sessionId, messageId: failed.requestId, kind: 'projection' as const }]
          : []),
        ...(failed.result
          ? [{ sessionId: failed.result.sessionId, messageId: failed.result.id, kind: 'membership' as const }]
          : [])
      ],
      failed.result ? [failed.result.sessionId] : []
    )
    return failed.result
  }

  prepareSessionDeletionTx(tx: DbOrTx, sessionIds: readonly string[]): AgentSessionMessageEntity[] {
    const deleting = [...new Set(sessionIds)]
    if (deleting.length === 0) return []
    const requests = chunk(deleting, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      tx
        .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
        .from(sessionMessagesTable)
        .where(
          and(
            inArray(sessionMessagesTable.sessionId, idChunk),
            inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
          )
        )
        .all()
    )
    const results: AgentSessionMessageEntity[] = []
    const now = new Date().toISOString()
    const error = { code: 'TARGET_SESSION_DELETED', message: 'Target Session was deleted' }
    for (const request of requests) {
      if (!request.delivery) continue
      tx.update(sessionMessagesTable)
        .set({
          deliveryStatus: 'failed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: 'interrupted', error, statusAt: now }
        })
        .where(
          and(
            eq(sessionMessagesTable.id, request.id),
            inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
          )
        )
        .run()

      if (request.delivery.replyPolicy !== 'completion' || deleting.includes(request.delivery.sender.sessionId))
        continue
      const existingResult = tx
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .all()[0]
      if (existingResult) continue
      const callerExists = tx
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(and(eq(sessionTable.id, request.delivery.sender.sessionId), isNull(sessionTable.deletedAt)))
        .limit(1)
        .all()[0]
      if (!callerExists) continue
      results.push(
        this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          parentId: request.data.deliveryReplyAnchor
            ? this.branchTip(request.delivery.sender.sessionId, request.data.deliveryReplyAnchor, tx)
            : undefined,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Target Session was deleted before completing the request.' }] },
            delivery: {
              version: 1,
              sender: request.delivery.receiver,
              receiver: request.delivery.sender,
              senderSnapshot: request.delivery.receiverSnapshot,
              receiverSnapshot: request.delivery.senderSnapshot,
              replyPolicy: 'none',
              sourceMessageId: null,
              outcome: 'failed',
              error,
              statusAt: now
            },
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      )
    }
    return results
  }

  /** Fail active requests before their target Agent is removed while the Session rows are retained. */
  prepareRetainedSessionAgentDeletionTx(tx: DbOrTx, sessionIds: readonly string[]): AgentSessionMessageEntity[] {
    const affected = new Set(sessionIds)
    if (affected.size === 0) return []
    const requests = tx
      .select({ ...getTableColumns(sessionMessagesTable), provenance: messageProvenanceSql() })
      .from(sessionMessagesTable)
      .where(
        and(
          inArray(sessionMessagesTable.sessionId, [...affected]),
          inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
        )
      )
      .all()
    const changes: AgentSessionMessageEntity[] = []
    const now = new Date().toISOString()
    const error = { code: AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_AGENT_DELETED, message: 'Target Agent was deleted' }
    for (const request of requests) {
      if (!request.delivery) continue
      const failedRequest = tx
        .update(sessionMessagesTable)
        .set({
          deliveryStatus: 'failed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: 'interrupted', error, statusAt: now }
        })
        .where(
          and(
            eq(sessionMessagesTable.id, request.id),
            inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
          )
        )
        .returning()
        .get()
      if (failedRequest) changes.push(this.rowToEntity(this.withParts(tx, failedRequest)))

      if (request.delivery.replyPolicy !== 'completion' || affected.has(request.delivery.sender.sessionId)) continue
      const existingResult = tx
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .get()
      if (existingResult) continue
      const callerExists = tx
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(and(eq(sessionTable.id, request.delivery.sender.sessionId), isNull(sessionTable.deletedAt)))
        .limit(1)
        .get()
      if (!callerExists) continue
      changes.push(
        this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          parentId: request.data.deliveryReplyAnchor
            ? this.branchTip(request.delivery.sender.sessionId, request.data.deliveryReplyAnchor, tx)
            : undefined,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Target Agent was deleted before completing the request.' }] },
            delivery: {
              version: 1,
              sender: request.delivery.receiver,
              receiver: request.delivery.sender,
              senderSnapshot: request.delivery.receiverSnapshot,
              receiverSnapshot: request.delivery.senderSnapshot,
              replyPolicy: 'none',
              sourceMessageId: null,
              outcome: 'interrupted',
              error,
              statusAt: now
            },
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      )
    }
    return changes
  }

  private publishDeliveryChange(sessionId: string, messageId: string, kind: 'membership' | 'projection'): void {
    this.publishDeliveryMutation([{ sessionId, messageId, kind }])
  }

  private publishDeliveryMutation(
    changes: readonly {
      sessionId: string
      messageId: string
      kind: 'membership' | 'projection'
    }[],
    activitySessionIds: readonly string[] = []
  ): void {
    if (changes.length === 0 && activitySessionIds.length === 0) return
    notifyDataApiDataChange([
      ...agentSessionReadModelEffects(activitySessionIds, 'projection'),
      ...changes.map(({ sessionId, messageId, kind }) => ({
        endpoint: '/agent-sessions/:sessionId/messages' as const,
        kind,
        routeParams: { sessionId },
        entityIds: [messageId]
      }))
    ])
  }

  /** Reject ownership changes before any message row is written in this transaction. */
  private assertExpectedAgentTx(db: DbOrTx, sessionId: string, expectedAgent: ExpectedAgent | undefined): void {
    if (!expectedAgent) return
    const expectedAgentId = typeof expectedAgent === 'string' ? expectedAgent : expectedAgent.id
    const [session] = db
      .select({
        agentId: sessionTable.agentId,
        agentUpdatedAt: agentTable.updatedAt,
        agentModel: agentTable.model,
        agentType: agentTable.type
      })
      .from(sessionTable)
      .leftJoin(agentTable, eq(sessionTable.agentId, agentTable.id))
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session || session.agentId !== expectedAgentId) {
      throw DataApiErrorFactory.notFound('Session', sessionId)
    }
    if (
      typeof expectedAgent !== 'string' &&
      (!session.agentUpdatedAt ||
        new Date(session.agentUpdatedAt).toISOString() !== expectedAgent.updatedAt ||
        session.agentModel !== expectedAgent.model ||
        (session.agentType === 'cherry-claw' ? 'claude-code' : session.agentType) !== expectedAgent.type)
    ) {
      throw DataApiErrorFactory.concurrentModification('Agent', expectedAgent.id)
    }
  }

  replaceMessageParts(
    sessionId: string,
    messageId: string,
    parts: AgentSessionMessageEntity['data']['parts'],
    projection?: RootProjectionCheckpoint,
    partIds?: readonly string[],
    positions?: ReadonlyMap<string, number>
  ): AgentSessionMessageEntity {
    const saved = application.get('DbService').withWriteTx((tx) => {
      const existingRow = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existingRow) throw DataApiErrorFactory.notFound('Message', messageId)

      const updatedAt = Date.now()
      const storedIds = partIds && readAgentSessionMessagePartIdsTx(tx, messageId)
      const retained = projection
        ? (existingRow.data.parts ?? []).flatMap((part, index) =>
            isDataUIPart(part) &&
            !parts?.some((native) => isDataUIPart(native) && native.type === part.type && native.id === part.id)
              ? [{ part, id: storedIds?.[index] }]
              : []
          )
        : []
      const data = {
        ...existingRow.data,
        parts: projection ? [...(parts ?? []), ...retained.map((item) => item.part)] : parts
      }
      const nextPartIds = partIds && [...partIds, ...retained.map((item) => item.id!)]
      const { storedData, offloaded, retainedToolCallIds, hasDeferredInput } = this.extractMessageToolOutputs(
        sessionId,
        messageId,
        data
      )
      const stored = splitAgentSessionMessageData(storedData)
      const [updated] = tx
        .update(sessionMessagesTable)
        .set({ data: stored.data, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .returning()
        .all()
      replaceAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId,
        parts: stored.parts,
        partIds: nextPartIds,
        positions,
        timestampMs: updatedAt
      })
      syncMessageToolOutputsTx(tx, sessionId, messageId, offloaded, retainedToolCallIds, existingRow.data, updatedAt)
      replaceAgentSessionMessageFileRefsTx(tx, messageId, data)
      if (projection) agentSessionContextService.saveRootProjectionTx(tx, sessionId, projection)
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      return this.rowToEntity({
        ...updated,
        provenance: existingRow.provenance,
        data: hasDeferredInput ? hydrateAgentSessionMessageDataTx(tx, messageId, data) : data
      })
    })

    notifyDataApiDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId },
        entityIds: [messageId]
      }
    ])
    return saved
  }

  /**
   * Saves parts that completed while their reply is still pending. An admission position can
   * insert one completed part without rebuilding the reply order in the runtime.
   * Returns false when the reply no longer accepts part saves (deleted or already settled).
   */
  saveCompletedMessageParts(
    sessionId: string,
    messageId: string,
    input: {
      order: Parameters<typeof writeAgentSessionMessagePartsTx>[1]['order']
      parts: ReadonlyMap<string, CherryMessagePart>
      positions?: ReadonlyMap<string, number>
    }
  ): boolean {
    return application.get('DbService').withWriteTx((tx) => {
      const row = tx
        .select({ status: sessionMessagesTable.status })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .get()
      if (row?.status !== 'pending') return false
      const ids = [...input.parts.keys()]
      const { storedData, offloaded, retainedToolCallIds } = this.extractMessageToolOutputs(sessionId, messageId, {
        parts: [...input.parts.values()]
      })
      const timestampMs = Date.now()
      writeAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId,
        order: input.order,
        positions: input.positions,
        parts: new Map(ids.map((id, index) => [id, storedData.parts[index]])),
        timestampMs
      })
      syncMessageToolOutputsTx(tx, sessionId, messageId, offloaded, retainedToolCallIds, undefined, timestampMs)
      const reference = sql<string>`coalesce(json_extract(${sessionMessagePartsTable.payload}, '$.output.$deferredToolResult.toolCallId'), json_extract(${sessionMessagePartsTable.payload}, '$.resultProviderMetadata.cherry.deferredToolOutput.$deferredToolResult.toolCallId'))`
      const retainedReferences = tx
        .select({ toolCallId: reference })
        .from(sessionMessagePartsTable)
        .where(
          and(
            eq(sessionMessagePartsTable.messageId, messageId),
            sql`(${sessionMessagePartsTable.type} = 'dynamic-tool' OR ${sessionMessagePartsTable.type} LIKE 'tool-%')`,
            isNotNull(reference)
          )
        )
      tx.delete(sessionToolOutputsTable)
        .where(
          and(
            eq(sessionToolOutputsTable.messageId, messageId),
            notInArray(sessionToolOutputsTable.toolCallId, retainedReferences)
          )
        )
        .run()
      if (ids.some((id) => input.parts.get(id)!.type === 'file'))
        replaceAgentSessionMessageFileRefsTx(tx, messageId, this.findExistingMessageRow(tx, sessionId, messageId)!.data)
      return true
    })
  }

  /**
   * Atomically settle one persisted agent-session approval card. The SDK callback is resolved only
   * after this returns true, so a displayed question cannot resume its agent while remaining stuck
   * as `approval-requested` in history.
   */
  applyToolApprovalDecision(
    sessionId: string,
    messageId: string,
    decision: ApprovalDecision,
    delivery: 'live' | 'undelivered'
  ): boolean {
    const applied = application.get('DbService').withWriteTx((tx) => {
      const existingRow = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existingRow) return false

      const existing = this.rowToEntity(existingRow)
      const parts = (existing.data.parts ?? []).map((part): CherryMessagePart => {
        if (
          !isToolUIPart(part) ||
          part.state !== 'output-error' ||
          part.approval?.id !== decision.approvalId ||
          part.approval.approved !== undefined
        )
          return part
        return { ...part, errorText: undefined, state: 'approval-requested', approval: { id: decision.approvalId } }
      })
      const hasPendingApproval = parts.some(
        (part) =>
          isToolUIPart(part) &&
          part.state === 'approval-requested' &&
          part.approval.id === decision.approvalId &&
          (delivery === 'live' || !NativeInteractionInputSchema.safeParse(part.input).success)
      )
      if (!hasPendingApproval) return false

      const updatedAt = Date.now()
      const nextParts = applyApprovalDecisions(parts, [decision])
      tx.update(sessionMessagesTable)
        .set({ updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .run()
      replaceAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId,
        parts: nextParts,
        partIds: readAgentSessionMessagePartIdsTx(tx, messageId),
        timestampMs: updatedAt
      })
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      agentSessionService.advanceLastActivityAtTx(tx, sessionId, updatedAt)
      return true
    })

    if (applied) {
      agentSessionService.notifyReadModelChange([sessionId], 'projection')
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds: [messageId]
        }
      ])
    }
    return applied
  }

  /**
   * Terminalize a persisted approval card whose live request went away without a user decision. The
   * row keeps its status and role — it is a settled interaction record, not a live turn — and only
   * the parked part becomes terminal, so the card stops reading as answerable.
   *
   * Returns `false` when nothing is parked on that approval: already answered, or already retired.
   */
  retireAbandonedApproval(sessionId: string, approvalId: string, errorText: string): boolean {
    const retired = application.get('DbService').withWriteTx((tx) => {
      const [parkedRow] = tx
        .select()
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            sql<boolean>`exists (
              select 1 from agent_session_message_part as part
              where part.message_id = ${sessionMessagesTable.id} and json_extract(part.payload, '$.state') = 'approval-requested'
                and json_extract(part.payload, '$.approval.id') = ${approvalId}
            )`
          )
        )
        .limit(1)
        .all()
      if (!parkedRow) return null

      const parked = this.rowToEntity(this.withParts(tx, parkedRow))
      const updatedAt = Date.now()
      // The part keeps every field it was parked with; only its state leaves the approval machine.
      const parts = (parked.data.parts ?? []).map((part): CherryMessagePart => {
        const parkedApprovalId = (part as { approval?: { id?: string } }).approval?.id
        if (!isToolUIPart(part) || part.state !== 'approval-requested' || parkedApprovalId !== approvalId) {
          return part
        }
        return { ...part, state: 'output-error', errorText } as unknown as CherryMessagePart
      })
      tx.update(sessionMessagesTable).set({ updatedAt }).where(eq(sessionMessagesTable.id, parked.id)).run()
      replaceAgentSessionMessagePartsTx(tx, {
        sessionId,
        messageId: parked.id,
        parts,
        partIds: readAgentSessionMessagePartIdsTx(tx, parked.id),
        timestampMs: updatedAt
      })
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      return parked.id
    })

    if (!retired) return false
    agentSessionService.notifyReadModelChange([sessionId], 'projection')
    notifyDataApiDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId },
        entityIds: [retired]
      }
    ])
    return true
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
registerDataService('AgentSessionMessageService', agentSessionMessageService)
