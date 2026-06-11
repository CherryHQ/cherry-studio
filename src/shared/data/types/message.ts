import { CURRENCY, objectValues } from '@cherrystudio/provider-registry'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  DataUIPart,
  DynamicToolUIPart,
  FileUIPart,
  InferUIMessageChunk,
  ReasoningUIPart,
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools
} from 'ai'
import * as z from 'zod'

import type { CherryDataPartTypes } from './uiParts'

/**
 * Canonical schema for message IDs. Accepts any UUID version — v1 legacy IDs
 * are UUIDv4, v2-native IDs are UUIDv7, dedup-remapped IDs are UUIDv4.
 *
 * Note: `MessageId` is inferred as `string` at the type level — it does NOT
 * carry runtime validation. Boundary handlers (IPC, DataApi) MUST validate
 * incoming IDs with `MessageIdSchema.parse()` to reject non-UUID strings.
 */
export const MessageIdSchema = z.uuid()
export type MessageId = z.infer<typeof MessageIdSchema>

/**
 * Message Statistics — token usage, cost, and performance for one assistant
 * message. Token fields mirror AI SDK v6 `LanguageModelUsage` 1:1 so the
 * stream accumulator projects provider usage into this shape without
 * translation.
 *
 * Scope: language models only. Image generation (Painting subsystem) and
 * embeddings (knowledge base) do not produce assistant messages and are not
 * modelled here.
 *
 * Cost is resolved at persistence time (`MessageServiceBackend`): computed
 * from the model's pricing (cache-aware) by default, or taken from the
 * provider's reported figure when the provider is flagged
 * `apiFeatures.reportsActualCost` (e.g. OpenRouter). `pricingSnapshot` freezes
 * the per-million rates so historical cost stays auditable if the model's
 * pricing later changes.
 */
export const MessageStatsSchema = z.strictObject({
  // ── Token usage (AI SDK v6 `LanguageModelUsage` names) ──
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  /**
   * Reasoning / thinking tokens. Convenience mirror of
   * `outputTokenDetails.reasoningTokens` — same value, kept flat so callers
   * that only need the single counter skip the nested object. Writers MUST
   * populate both from the same source so they never diverge.
   */
  reasoningTokens: z.number().optional(),

  /** Input token breakdown (cache accounting). Mirrors v6 `inputTokenDetails`. */
  inputTokenDetails: z
    .strictObject({
      noCacheTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
      cacheWriteTokens: z.number().optional()
    })
    .optional(),
  /** Output token breakdown. Mirrors v6 `outputTokenDetails`. */
  outputTokenDetails: z
    .strictObject({
      textTokens: z.number().optional(),
      reasoningTokens: z.number().optional()
    })
    .optional(),

  // ── Cost (resolved at message completion) ──
  /** Aggregate cost in `costCurrency`. */
  cost: z.number().optional(),
  /** Currency of `cost` / `costBreakdown` / `pricingSnapshot` rates. */
  costCurrency: z.enum(objectValues(CURRENCY)).optional(),
  /** Provider-reported actual spend vs locally computed from pricing. */
  costSource: z.enum(['provider', 'computed']).optional(),
  /** Per-bucket cost. For provider-reported cost this is a computed cross-check. */
  costBreakdown: z
    .strictObject({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
      /** Per-image cost (image-generation requests; priced via `pricing.perImage`). */
      image: z.number().optional()
    })
    .optional(),
  /** Per-million-token rates captured at completion time, for historical audit. */
  pricingSnapshot: z
    .strictObject({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
      capturedAt: z.iso.datetime()
    })
    .optional(),

  // ── Performance metrics (measured locally) ──
  timeFirstTokenMs: z.number().optional(),
  timeCompletionMs: z.number().optional(),
  timeThinkingMs: z.number().optional()
})
export type MessageStats = z.infer<typeof MessageStatsSchema>

// ============================================================================
// Message Data
// ============================================================================

/** Cherry-specific UIMessagePart with our custom DataUIPart types baked in. */
export type CherryMessagePart = UIMessagePart<CherryDataPartTypes, UITools>

/**
 * Message data field structure — the type for the `data` column in the
 * message table. Messages are stored in AI SDK `UIMessage.parts` format.
 *
 * Accepts the generic `UIMessagePart[]` for writes — the DB stores whatever
 * parts the AI SDK produces. Readers can narrow to `CherryMessagePart[]` when
 * they need Cherry-specific data part type safety.
 */
export interface MessageData {
  parts?: CherryMessagePart[]
}

// ── Cherry-specific UI message types ────────────────────────────────

/**
 * Metadata carried on a streamed `CherryUIMessage`.
 *
 * Token fields mirror `MessageStats` (AI SDK v6 names) so the stream
 * accumulator can write a snapshot into `exec.finalMessage.metadata` and the
 * persistence backend translates it 1:1 into the DB `stats` column
 * (`statsFromTerminal`).
 *
 * Shallow-merge invariant: the AI SDK merges each `message-metadata` chunk
 * into the accumulating message as `{ ...prev, ...next }` (shallow). The usage
 * writers emit a FULL cumulative snapshot of `stats` every step, so the nested
 * breakdown survives. A writer MUST never emit a partial `stats` patch — a
 * snapshot missing `inputTokenDetails` would replace the whole object and drop
 * earlier steps' breakdown.
 */
export interface CherryUIMessageMetadata {
  // ── DB-backed tree/ownership (populated by `toUIMessage` from the branch
  //    response, or seeded locally when pushing a placeholder before the
  //    first refresh completes). Keeping these on the message itself means
  //    `adaptedMessages` and every other consumer can read directly from
  //    `message.metadata` without a parallel `metadataMap` lookup that
  //    lags behind state.messages.
  /** `parent_id` of the persisted row; drives `askId` / tree walks. */
  parentId?: string | null
  /** Non-zero for messages that belong to a regenerate/multi-model cohort. */
  siblingsGroupId?: number
  /** `UniqueModelId` (`providerId::modelId`) the assistant was generated with. */
  modelId?: string
  /** Snapshot captured at message creation (`{id, name, provider, group?}`). */
  modelSnapshot?: ModelSnapshot
  /** Persistence status: mirrors the DB row's `status` column. */
  status?: MessageStatus

  /** Creation timestamp (ISO). */
  createdAt?: string
  /** Last modification timestamp (ISO). Mirrors v1 Message.updatedAt during migration. */
  updatedAt?: string

  // ── Token stats. First four duplicate fields on `stats` so call-sites
  //    that only need a single counter can skip the nested object.
  /** Total tokens reported by the provider (mirrors `MessageStats.totalTokens`). */
  totalTokens?: number
  /** Input tokens (AI SDK `inputTokens`; mirrors `MessageStats.inputTokens`). */
  inputTokens?: number
  /** Output tokens (AI SDK `outputTokens`; mirrors `MessageStats.outputTokens`). */
  outputTokens?: number
  /**
   * Reasoning / thinking tokens — AI SDK `outputTokenDetails.reasoningTokens`
   * (Gemini thoughts, Anthropic extended thinking, OpenAI o-series).
   */
  reasoningTokens?: number
  /**
   * Transient provider-reported cost candidate (USD), extracted from
   * `LanguageModelUsage.raw` (e.g. OpenRouter `usage.cost`). NOT persisted to
   * `stats`; only consumed by `enrichStatsWithCost`, which decides whether to
   * trust it based on `provider.apiFeatures.reportsActualCost`.
   */
  providerCostUsd?: number
  /** Full persisted stats (tokens + durations) when available. */
  stats?: MessageStats
}

/** Cherry Studio's UIMessage with custom metadata and data part types. */
export type CherryUIMessage = UIMessage<CherryUIMessageMetadata, CherryDataPartTypes>

/** Cherry Studio's UIMessageChunk — inferred from CherryUIMessage. */
export type CherryUIMessageChunk = InferUIMessageChunk<CherryUIMessage>

// Re-export AI SDK part types for convenience
export type {
  DataUIPart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools
}

//FIXME [v2] 注意，以下类型只是占位，接口未稳定，随时会变

// ============================================================================
// Content Reference Types
// ============================================================================

/**
 * Reference category for content references
 */
export enum ReferenceCategory {
  CITATION = 'citation',
  MENTION = 'mention'
}

/**
 * Citation source type
 */
export enum CitationType {
  WEB = 'web',
  KNOWLEDGE = 'knowledge',
  MEMORY = 'memory'
}

/**
 * Base reference structure for inline content references
 */
export interface BaseReference {
  category: ReferenceCategory
  /** Text marker in content, e.g., "[1]", "@user" */
  marker?: string
  /** Position range in content */
  range?: { start: number; end: number }
}

/**
 * Base citation reference
 */
interface BaseCitationReference extends BaseReference {
  category: ReferenceCategory.CITATION
  citationType: CitationType
}

/**
 * Web search citation reference
 * Data structure compatible with WebSearchResponse from renderer
 */
export interface WebCitationReference extends BaseCitationReference {
  citationType: CitationType.WEB
  content: {
    results?: unknown // types needs to be migrated from renderer ( newMessage.ts )
    source: unknown // types needs to be migrated from renderer ( newMessage.ts )
  }
}

/**
 * Knowledge base citation reference
 * Data structure compatible with KnowledgeReference[] from renderer
 */
export interface KnowledgeCitationReference extends BaseCitationReference {
  citationType: CitationType.KNOWLEDGE

  // types needs to be migrated from renderer ( newMessage.ts )
  content: {
    id: number
    content: string
    sourceUrl: string
    type: string
    file?: unknown
    metadata?: Record<string, unknown>
  }[]
}

/**
 * Memory citation reference
 * Data structure compatible with MemoryItem[] from renderer
 */
export interface MemoryCitationReference extends BaseCitationReference {
  citationType: CitationType.MEMORY
  // types needs to be migrated from renderer ( newMessage.ts )
  content: {
    id: string
    memory: string
    hash?: string
    createdAt?: string
    updatedAt?: string
    score?: number
    metadata?: Record<string, unknown>
  }[]
}

/**
 * Union type of all citation references
 */
export type CitationReference = WebCitationReference | KnowledgeCitationReference | MemoryCitationReference

/**
 * Mention reference for @mentions in content
 * References a Model entity
 */
export interface MentionReference extends BaseReference {
  category: ReferenceCategory.MENTION
  /** Model ID being mentioned */
  modelId: string //FIXME 未定接口，model的数据结构还未确定，先占位
  /** Display name for the mention */
  displayName?: string
}

/**
 * Union type of all content references
 */
export type ContentReference = CitationReference | MentionReference

/**
 * Type guard: check if reference is a citation
 */
export function isCitation(ref: ContentReference): ref is CitationReference {
  return ref.category === ReferenceCategory.CITATION
}

/**
 * Type guard: check if reference is a mention
 */
export function isMention(ref: ContentReference): ref is MentionReference {
  return ref.category === ReferenceCategory.MENTION
}

/**
 * Type guard: check if reference is a web citation
 */
export function isWebCitation(ref: ContentReference): ref is WebCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.WEB
}

/**
 * Type guard: check if reference is a knowledge citation
 */
export function isKnowledgeCitation(ref: ContentReference): ref is KnowledgeCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.KNOWLEDGE
}

/**
 * Type guard: check if reference is a memory citation
 */
export function isMemoryCitation(ref: ContentReference): ref is MemoryCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.MEMORY
}

/**
 * Serialized error for storage
 */
export interface SerializedErrorData {
  name?: string
  message: string
  code?: string
  stack?: string
  cause?: unknown
}

/**
 * Runtime schema for `MessageData`. `parts` is optional on the TS interface
 * and the DB column, so the runtime check mirrors that: accept any object,
 * reject only if `parts` is present and the wrong shape. Part entry types
 * stay runtime-opaque for now; tighten with per-entry schemas in a follow-up.
 */
export const MessageDataSchema = z.custom<MessageData>((value) => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as MessageData
  if (v.parts !== undefined && !Array.isArray(v.parts)) return false
  return true
})

// ============================================================================
// Snapshot Types (immutable records captured at message creation time)
// ============================================================================

/**
 * Model snapshot captured at message creation time.
 * Preserves model identity and metadata even if the model is later removed from provider.
 *
 * TODO: Replace with Pick/Omit from v2 Model type once stabilized.
 */
export const ModelSnapshotSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  group: z.string().optional()
})
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>

// ============================================================================
// Message Entity Types
// ============================================================================

/**
 * Message role - user, assistant, or system
 */
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const TOPIC_MESSAGE_SEARCH_ROLES = ['user', 'assistant'] as const satisfies readonly MessageRole[]
export type TopicMessageSearchRole = (typeof TOPIC_MESSAGE_SEARCH_ROLES)[number]

export const AGENT_SESSION_MESSAGE_SEARCH_ROLES = [
  'user',
  'assistant',
  'system'
] as const satisfies readonly MessageRole[]
export type AgentSessionMessageSearchRole = (typeof AGENT_SESSION_MESSAGE_SEARCH_ROLES)[number]

export function coerceSearchRole<TRole extends MessageRole>(
  role: string,
  allowedRoles: readonly TRole[]
): TRole | undefined {
  return allowedRoles.includes(role as TRole) ? (role as TRole) : undefined
}

/**
 * Message status
 * - pending: Placeholder created, streaming in progress
 * - success: Completed successfully
 * - error: Failed with error
 * - paused: User stopped generation
 */
export const MessageStatusSchema = z.enum(['pending', 'success', 'error', 'paused'])
export type MessageStatus = z.infer<typeof MessageStatusSchema>

/**
 * Complete message entity as stored in database.
 *
 * JSON blob columns (`data`, `modelSnapshot`, `stats`) are typed via
 * {@link MessageDataSchema} / {@link ModelSnapshotSchema} / {@link MessageStatsSchema}.
 */
export const MessageSchema = z.strictObject({
  /** Message ID (UUID — v4 legacy or v7 v2-native) */
  id: MessageIdSchema,
  /** Topic ID this message belongs to */
  topicId: z.string(),
  /** Parent message ID (null for root) */
  parentId: z.string().nullable(),
  /** Message role */
  role: MessageRoleSchema,
  /** Message content (blocks with inline references) */
  data: MessageDataSchema,
  /** Searchable text extracted from data.blocks (DB DEFAULT ''; trigger fills on insert/update) */
  searchableText: z.string(),
  /** Message status */
  status: MessageStatusSchema,
  /** Siblings group ID (0 = normal branch, >0 = multi-model response group) */
  siblingsGroupId: z.number(),
  // Assistant info is derived via topic → assistant FK chain; not stored on message.
  /** Model identifier */
  modelId: z.string().nullable().optional(),
  /** Snapshot of model at message creation time */
  modelSnapshot: ModelSnapshotSchema.nullable().optional(),
  /** Statistics: token usage, performance metrics */
  stats: MessageStatsSchema.nullable().optional(),
  /** Creation timestamp (ISO string) */
  createdAt: z.iso.datetime(),
  /** Last update timestamp (ISO string) */
  updatedAt: z.iso.datetime()
})
export type Message = z.infer<typeof MessageSchema>

// ============================================================================
// Tree Structure Types
// ============================================================================

/**
 * Lightweight tree node for tree visualization (ReactFlow)
 * Contains only essential display info, not full message content
 */
export interface TreeNode {
  /** Message ID */
  id: string
  /** Parent message ID (null for root, omitted in SiblingsGroup.nodes) */
  parentId?: string | null
  /** Message role */
  role: MessageRole
  /** Content preview (first 50 characters) */
  preview: string
  /** Model identifier */
  modelId?: string | null
  /** Message status */
  status: MessageStatus
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Whether this node has children (for expand indicator) */
  hasChildren: boolean
}

/**
 * Group of sibling nodes with same parentId and siblingsGroupId
 * Used for multi-model responses in tree view
 */
export interface SiblingsGroup {
  /** Parent message ID */
  parentId: string
  /** Siblings group ID (non-zero) */
  siblingsGroupId: number
  /** Nodes in this group (parentId omitted to avoid redundancy) */
  nodes: Omit<TreeNode, 'parentId'>[]
}

/**
 * Tree query response structure
 */
export interface TreeResponse {
  /** Regular nodes (siblingsGroupId = 0) */
  nodes: TreeNode[]
  /** Multi-model response groups (siblingsGroupId != 0) */
  siblingsGroups: SiblingsGroup[]
  /** Current active node ID */
  activeNodeId: string | null
}

// ============================================================================
// Branch Message Types
// ============================================================================

/**
 * Message with optional siblings group for conversation view
 * Used in GET /topics/:id/messages response
 */
export interface BranchMessage {
  /** The message itself */
  message: Message
  /** Other messages in the same siblings group (only when siblingsGroupId != 0 and includeSiblings=true) */
  siblingsGroup?: Message[]
}

/**
 * Branch messages response structure
 */
export interface BranchMessagesResponse extends CursorPaginationResponse<BranchMessage> {
  /** Current active node ID */
  activeNodeId: string | null
  /**
   * Topic's `assistantId` — embedded in the response so renderers don't
   * need a separate `/topics/:id` round-trip just to enrich each message
   * with its parent assistant's id. Always present in successful responses.
   */
  assistantId: string | null
}
