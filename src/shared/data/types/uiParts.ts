/**
 * Custom DataUIPart schemas for Cherry Studio.
 *
 * These extend AI SDK's UIMessage.parts with application-specific
 * part types that have no built-in equivalent.
 *
 * AI SDK built-in parts used directly:
 * - TextUIPart (main_text → text)
 * - ReasoningUIPart (thinking → reasoning)
 * - ToolUIPart (tool → tool-{name})
 * - FileUIPart (image/file → file)
 *
 * Custom DataUIParts (no AI SDK equivalent):
 * - data-error (error blocks)
 * - data-translation (translation blocks)
 * - data-video (video blocks)
 * - data-compact (compact/summary blocks)
 * - data-compaction-anchor (timeline anchor for completed runtime compaction)
 * - data-agent-task-event (Claude Agent SDK task lifecycle event)
 * - data-knowledge-scope (knowledge bases available to this user turn)
 * - data-clear (context boundary marker)
 * - data-code (code blocks)
 * - data-retry (transient model-retry/fallback status; shown live, never persisted)
 */

import * as z from 'zod'

import type { CompactionAnchorData } from '@shared/ai/compaction'
import { type FileType, FileTypeSchema } from '@shared/types/file'

import type { SerializedError } from '../../types/error'
import type { CherryMessagePart } from './message'

// ============================================================================
// Custom DataUIPart data shapes
// ============================================================================

/** Error data — replaces ErrorBlock. May carry the full serialized error payload. */
export type ErrorPartData = Partial<SerializedError> & {
  name?: string | null
  message?: string | null
  stack?: string | null
  code?: string
}

/** Translation data — replaces TranslationBlock */
export interface TranslationPartData {
  content: string
  targetLanguage: string
  sourceLanguage?: string
  sourceBlockId?: string
}

/** Video data — replaces VideoBlock */
export interface VideoPartData {
  url?: string
  filePath?: string
}

/** Compact/summary data — replaces CompactBlock */
export interface CompactPartData {
  content: string
  compactedContent: string
}

/** Compaction anchor data — marks where a runtime context compaction completed. */
export type CompactionAnchorPartData = CompactionAnchorData

/** Claude Agent SDK task lifecycle event data. Hidden inline state consumed by agent status panels. */
export interface AgentTaskEventPartData {
  event: 'started' | 'progress' | 'updated' | 'notification'
  taskId: string
  toolUseId?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'stopped' | 'error'
  title?: string
  activeText?: string
  description?: string
  summary?: string
  subagentType?: string
  taskType?: string
  workflowName?: string
  prompt?: string
  lastToolName?: string
  outputFile?: string
  error?: string
  /** Per-task edge authority for whether this task has detached from its spawning turn. */
  isBackgrounded?: boolean
  skipTranscript?: boolean
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
}

/** Knowledge scope captured on a user message. Hidden from both the transcript and the model. */
export interface KnowledgeScopePartData {
  baseIds: string[]
}

/** Context boundary marker. Hidden from both the transcript and the model. */
export type ClearPartData = Record<string, never>

/** The runtime could not resume the prior CLI conversation and continued on a fresh one. */
export type ConversationResetPartData = Record<string, never>

/** Code data — replaces CodeBlock */
export interface CodePartData {
  content: string
  language: string
}

/**
 * Model retry/fallback status. Transient: emitted live while a chat model call
 * is being retried or failed over to a fallback model, and stripped before the
 * assistant message is persisted (see PersistenceListener). Never written to DB.
 */
export type RetryPartData =
  | {
      state: 'retrying'
      /** Model id that will handle the upcoming attempt. */
      modelId: string
      /** 1-based number of the upcoming attempt, including the original call. */
      attempt: number
      /** Short human reason, e.g. "http 429: rate limit exceeded". */
      reason: string
    }
  | {
      state: 'settled'
    }

// ============================================================================
// Cherry DataUIPart type map (for useChat dataPartSchemas)
// ============================================================================

/**
 * All custom DataUIPart types for Cherry Studio.
 * Used with `useChat({ dataPartSchemas })` to enable type-safe custom parts.
 */
export type CherryDataPartTypes = {
  error: ErrorPartData
  translation: TranslationPartData
  video: VideoPartData
  compact: CompactPartData
  'compaction-anchor': CompactionAnchorPartData
  'conversation-reset': ConversationResetPartData
  'agent-task-event': AgentTaskEventPartData
  'knowledge-scope': KnowledgeScopePartData
  clear: ClearPartData
  code: CodePartData
  retry: RetryPartData
}

// ============================================================================
// Cherry per-part providerMetadata.cherry shapes
// ============================================================================

/** Cherry metadata on a TextUIPart. */
export interface CherryTextMeta {
  /** Content references (citations, mentions). */
  references?: unknown[]
  /** Composer inline token display snapshot — on user TextUIPart by convention. */
  composer?: ComposerMessageSnapshot
}

/** Cherry metadata on a ReasoningUIPart. */
export interface CherryReasoningMeta {
  /** Thinking duration in ms. */
  thinkingMs?: number
  /** Thinking start timestamp in epoch ms. */
  startedAt?: number
}

/** Cherry metadata on a ToolUIPart / DynamicToolUIPart. */
export interface CherryToolMeta {
  /** Approval bridge transport. */
  transport?: string
  /** Tool name (used by approval bridge before the part has been finalized). */
  toolName?: string
  /** Runtime-neutral subagent linkage: the spawning tool call this part nests under. */
  parentToolCallId?: string
  /** MCP / builtin tool identity. Matches `ToolType` consumed by `toolResponse.ts`. */
  tool?: {
    serverId?: string
    serverName?: string
    type?: 'mcp' | 'builtin' | 'provider'
  }
}

/** A single actionable step in an AI error diagnosis. */
export interface DiagnosisStep {
  text: string
}

/** AI-generated diagnosis of a chat error. Persisted on a data-error part so it survives popup close / reload. */
export interface DiagnosisResult {
  summary: string
  category: string
  explanation: string
  steps: DiagnosisStep[]
}

/** Cherry metadata on a data-error DataUIPart. */
export interface CherryErrorMeta {
  /** Persisted AI error diagnosis, rehydrated into the error-detail popup after close / reload. */
  diagnosis?: DiagnosisResult
}

/** Cherry metadata on a FileUIPart. */
export interface CherryFileMeta {
  /**
   * FileEntryId for internal files (v1→v2 migrator preserves this from
   * `OldFileBlock.file.id` / `OldImageBlock.file.id`). External (user-path)
   * files have no fileEntryId. Consumed by `ChatMigrator` to backfill
   * `chat_message_file_ref` rows after migration.
   */
  fileEntryId?: string
  /** Composer file token association identity. Not a path, filename, or file storage id. */
  fileTokenSourceId?: string
  /** Safe composer-only source marker used to restore sent-message token previews. */
  composerFileKind?: 'pasted-text'
}

/**
 * Conditional mapping from a part's `type` literal to its cherry-meta shape.
 * Parts without a registered shape have no cherry meta — represented as `Record<string, never>`.
 */
export type CherryMetaForPartType<T extends string> = T extends 'text'
  ? CherryTextMeta
  : T extends 'reasoning'
    ? CherryReasoningMeta
    : T extends `tool-${string}` | 'dynamic-tool'
      ? CherryToolMeta
      : T extends 'file'
        ? CherryFileMeta
        : T extends 'data-error'
          ? CherryErrorMeta
          : Record<string, never>

/**
 * @deprecated Use `CherryTextMeta` / `CherryReasoningMeta` / `CherryToolMeta` / `CherryFileMeta`
 * directly, or `CherryMetaForPartType<P['type']>` in generic positions. Retained for one PR
 * cycle to keep external imports compiling.
 */
export type CherryProviderMetadata = CherryTextMeta & CherryReasoningMeta & CherryToolMeta & CherryFileMeta

// ============================================================================
// Zod schemas — runtime validation at the read boundary
// ============================================================================

const ComposerMessageFileTokenPayloadSchema: z.ZodType<ComposerMessageFileTokenPayload> = z.object({
  type: FileTypeSchema.optional(),
  ext: z.string().optional(),
  name: z.string().optional(),
  // Serialized key — mirrors the `origin_name` file-part payload key. Do not rename.
  origin_name: z.string().optional(),
  size: z.number().optional()
})

const ComposerMessageTokenKindSchema = z.enum([
  'skill',
  'link',
  'file',
  'folder',
  'command',
  'knowledge',
  'reference',
  'quote'
])

const ComposerMessageTokenSchema: z.ZodType<ComposerMessageToken> = z.object({
  id: z.string(),
  kind: ComposerMessageTokenKindSchema,
  label: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  index: z.number(),
  textOffset: z.number(),
  promptText: z.string().optional(),
  payload: ComposerMessageFileTokenPayloadSchema.optional()
})

const ComposerMessageSnapshotSchema: z.ZodType<ComposerMessageSnapshot> = z.object({
  version: z.literal(1),
  tokens: z.array(ComposerMessageTokenSchema)
})

export const CherryTextMetaSchema: z.ZodType<CherryTextMeta> = z.object({
  references: z.array(z.unknown()).optional(),
  composer: ComposerMessageSnapshotSchema.optional()
})

export const CherryReasoningMetaSchema: z.ZodType<CherryReasoningMeta> = z.object({
  thinkingMs: z.number().optional(),
  startedAt: z.number().optional()
})

export const CherryToolMetaSchema: z.ZodType<CherryToolMeta> = z.object({
  transport: z.string().optional(),
  toolName: z.string().optional(),
  tool: z
    .object({
      serverId: z.string().optional(),
      serverName: z.string().optional(),
      type: z.enum(['mcp', 'builtin', 'provider']).optional()
    })
    .optional()
})

export const CherryFileMetaSchema: z.ZodType<CherryFileMeta> = z.object({
  fileEntryId: z.string().optional(),
  fileTokenSourceId: z.string().optional(),
  composerFileKind: z.literal('pasted-text').optional()
})

const DiagnosisStepSchema: z.ZodType<DiagnosisStep> = z.object({
  text: z.string()
})

const DiagnosisResultSchema: z.ZodType<DiagnosisResult> = z.object({
  summary: z.string(),
  category: z.string(),
  explanation: z.string(),
  steps: z.array(DiagnosisStepSchema)
})

export const CherryErrorMetaSchema: z.ZodType<CherryErrorMeta> = z.object({
  diagnosis: DiagnosisResultSchema.optional()
})

export const KnowledgeScopePartDataSchema: z.ZodType<KnowledgeScopePartData> = z.strictObject({
  baseIds: z.array(z.string().min(1))
})

// Table-driven dispatch — part `type` → schema. First match wins.
const SCHEMA_BY_PART_TYPE: ReadonlyArray<readonly [(t: string) => boolean, z.ZodTypeAny]> = [
  [(t) => t === 'text', CherryTextMetaSchema],
  [(t) => t === 'reasoning', CherryReasoningMetaSchema],
  [(t) => t === 'dynamic-tool' || t.startsWith('tool-'), CherryToolMetaSchema],
  [(t) => t === 'file', CherryFileMetaSchema],
  [(t) => t === 'data-error', CherryErrorMetaSchema]
]

function schemaForPartType(type: string): z.ZodTypeAny | null {
  for (const [match, schema] of SCHEMA_BY_PART_TYPE) {
    if (match(type)) return schema
  }
  return null
}

const KNOWLEDGE_SCOPE_PART_TYPE = 'data-knowledge-scope'
const CLEAR_CONTEXT_PART_TYPE = 'data-clear'

export type ClearContextPart = Extract<CherryMessagePart, { type: typeof CLEAR_CONTEXT_PART_TYPE }>

/** Create the hidden DataUIPart that marks a model-context boundary. */
export function createClearContextPart(): ClearContextPart {
  return {
    type: CLEAR_CONTEXT_PART_TYPE,
    data: {}
  }
}

/** Whether a message's persisted parts contain a model-context boundary. */
export function hasClearContextPart(parts: readonly CherryMessagePart[] | undefined): boolean {
  return parts?.some((part) => part.type === CLEAR_CONTEXT_PART_TYPE) ?? false
}

/** Whether persisted message values describe a blank user turn, without making any tree-level claim. */
export function isBlankUserTurn(input: {
  role: string
  status: string | undefined
  parts: readonly unknown[] | undefined
}): boolean {
  return input.role === 'user' && input.status === 'success' && (input.parts?.length ?? 0) === 0
}

/** Replace the aggregate knowledge scope part while preserving every content part. */
export function withKnowledgeScopePart(parts: CherryMessagePart[], baseIds: readonly string[]): CherryMessagePart[] {
  const contentParts = parts.filter((part) => part.type !== KNOWLEDGE_SCOPE_PART_TYPE)
  const uniqueBaseIds = Array.from(new Set(baseIds.filter(Boolean)))
  if (uniqueBaseIds.length === 0) return contentParts

  return [
    ...contentParts,
    {
      type: KNOWLEDGE_SCOPE_PART_TYPE,
      data: { baseIds: uniqueBaseIds }
    }
  ]
}

/** Read the last valid aggregate scope. Missing or malformed parts yield `undefined`. */
export function getKnowledgeBaseIdsFromParts(parts: readonly CherryMessagePart[]): string[] | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type !== KNOWLEDGE_SCOPE_PART_TYPE || !('data' in part)) continue

    const result = KnowledgeScopePartDataSchema.safeParse(part.data)
    if (result.success) return Array.from(new Set(result.data.baseIds))
  }
  return undefined
}

// ============================================================================
// Accessors — single read/write boundary for providerMetadata.cherry
// ============================================================================

export type ComposerMessageTokenKind = z.infer<typeof ComposerMessageTokenKindSchema>

export interface ComposerMessageFileTokenPayload {
  type?: FileType
  ext?: string
  name?: string
  /** Serialized key — mirrors the `origin_name` file-part payload key. */
  origin_name?: string
  size?: number
}

export type ComposerMessageTokenPayload = ComposerMessageFileTokenPayload

export interface ComposerMessageToken {
  id: string
  kind: ComposerMessageTokenKind
  label: string
  icon?: string
  description?: string
  index: number
  textOffset: number
  promptText?: string
  payload?: ComposerMessageTokenPayload
}

export interface ComposerMessageSnapshot {
  version: 1
  tokens: ComposerMessageToken[]
}

/**
 * Read cherry meta with runtime validation. Returns `undefined` for missing,
 * malformed, or part types without a registered schema. Never throws — this
 * is a leaf util in `packages/shared`, so callers that need to surface
 * validation failures should `safeParse` the appropriate `Cherry*MetaSchema`
 * directly with their own logger.
 */
export function readCherryMeta<P extends CherryMessagePart>(part: P): CherryMetaForPartType<P['type']> | undefined {
  const raw = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata?.cherry
  if (!raw || typeof raw !== 'object') return undefined
  const schema = schemaForPartType(part.type)
  if (!schema) return undefined
  const result = schema.safeParse(raw)
  if (!result.success) return undefined
  return result.data as CherryMetaForPartType<P['type']>
}

/**
 * Patch cherry meta with compile-time part-scoping. Writing a field that
 * doesn't belong to the part's meta shape fails to compile — e.g.
 * `withCherryMeta(textPart, { thinkingMs: 1 })` is a type error.
 */
export function withCherryMeta<P extends CherryMessagePart>(
  part: P,
  patch: Partial<CherryMetaForPartType<P['type']>>
): P {
  const existingMeta = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata
  const existingCherry = (existingMeta?.cherry ?? {}) as Record<string, unknown>
  return {
    ...part,
    providerMetadata: {
      ...existingMeta,
      cherry: { ...existingCherry, ...(patch as Record<string, unknown>) }
    }
  }
}
