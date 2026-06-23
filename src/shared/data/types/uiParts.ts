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
 * - data-code (code blocks)
 */

import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import { type FileType, FileTypeSchema } from '@shared/types/file'
import * as z from 'zod'

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
export type CompactionAnchorPartData = AgentSessionCompactionAnchorData

/** Claude Agent SDK task lifecycle event data. Hidden inline state consumed by agent status panels. */
export interface AgentTaskEventPartData {
  event: 'started' | 'progress' | 'updated' | 'notification'
  taskId: string
  toolUseId?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'error'
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
  skipTranscript?: boolean
  usage?: {
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
}

/** Code data — replaces CodeBlock */
export interface CodePartData {
  content: string
  language: string
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
  'agent-task-event': AgentTaskEventPartData
  code: CodePartData
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
  /** MCP / builtin tool identity. Matches `ToolType` consumed by `toolResponse.ts`. */
  tool?: {
    serverId?: string
    serverName?: string
    type?: 'mcp' | 'builtin' | 'provider'
  }
}

/** Cherry metadata on a FileUIPart. */
export interface CherryFileMeta {
  /**
   * FileEntryId for internal files (v1→v2 migrator preserves this from
   * `OldFileBlock.file.id` / `OldImageBlock.file.id`). External (user-path)
   * files have no fileEntryId. Consumed by `ChatMigrator` to backfill
   * `file_ref` rows after migration.
   */
  fileEntryId?: string
  /** Composer file token association identity. Not a path, filename, or file storage id. */
  fileTokenSourceId?: string
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

const ComposerMessageTokenSchema: z.ZodType<ComposerMessageToken> = z.object({
  id: z.string(),
  kind: z.enum(['skill', 'file', 'command', 'knowledge', 'reference', 'quote']),
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
  fileTokenSourceId: z.string().optional()
})

// Table-driven dispatch — part `type` → schema. First match wins.
const SCHEMA_BY_PART_TYPE: ReadonlyArray<readonly [(t: string) => boolean, z.ZodTypeAny]> = [
  [(t) => t === 'text', CherryTextMetaSchema],
  [(t) => t === 'reasoning', CherryReasoningMetaSchema],
  [(t) => t === 'dynamic-tool' || t.startsWith('tool-'), CherryToolMetaSchema],
  [(t) => t === 'file', CherryFileMetaSchema]
]

function schemaForPartType(type: string): z.ZodTypeAny | null {
  for (const [match, schema] of SCHEMA_BY_PART_TYPE) {
    if (match(type)) return schema
  }
  return null
}

// ============================================================================
// Accessors — single read/write boundary for providerMetadata.cherry
// ============================================================================

export type ComposerMessageTokenKind = 'skill' | 'file' | 'command' | 'knowledge' | 'reference' | 'quote'

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
  } as P
}
