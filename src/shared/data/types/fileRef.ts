/**
 * FileRef — associations from business entities to FileEntry records.
 *
 * This module owns the complete cross-domain ref union. It may depend on the
 * FileEntry and Message contracts; `file.ts` deliberately does not depend on
 * any business domain.
 *
 * ## Adding a new persistent business ref
 *
 * 1. Add a variant section below (`{domain}SourceType` / `{domain}Roles` /
 *    `{domain}RefFields` / `{domain}FileRefSchema = createRefSchema(...)`),
 *    following `tempSession` as a minimal template.
 * 2. Add a dedicated SQLite association table with FKs to `file_entry` and the
 *    owning source table so deleting the source cascades refs at the DB layer.
 * 3. Register the variant in the aggregate: add its source-type literal to
 *    `allSourceTypes` and its schema to the `FileRefSchema` union.
 * 4. Route persistent write/delete through the owning business service;
 *    `FileRefService` only exposes cross-source query/ref-count + temp helpers.
 *
 * `temp_session` is the exception: app-session memory only (CacheService), not
 * SQLite, pruned via orphan sweep. Knowledge files are owned by the Knowledge
 * workflow and do not register FileManager refs.
 */

import * as z from 'zod'

import { FileEntryIdSchema, TimestampSchema } from './file'
import { MessageIdSchema } from './message'

// ─── Common ref infrastructure ───

export const refCommonFields = Object.freeze({
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file entry ID (UUID v4 for migrated entries, UUID v7 for new entries) */
  fileEntryId: FileEntryIdSchema,
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
})

/** Shape constraint for business-specific ref fields passed to `createRefSchema`. */
export type BusinessRefShape = {
  sourceType: z.ZodLiteral<string>
  sourceId: z.ZodType<string>
  role: z.ZodEnum
}

/** Merge common ref fields with one business-specific ref shape. */
export const createRefSchema = <T extends BusinessRefShape>(shape: T): z.ZodObject<typeof refCommonFields & T> =>
  z.object({
    ...refCommonFields,
    ...shape
  })

// ─── temp_session variant ───

export const tempSessionSourceType = 'temp_session' as const
export const tempSessionRoles = ['pending'] as const
export const tempSessionRefFields = {
  sourceType: z.literal(tempSessionSourceType),
  sourceId: z.string().min(1),
  role: z.enum(tempSessionRoles)
}
export const tempSessionFileRefSchema = createRefSchema(tempSessionRefFields)

// ─── chat_message variant ───

export const chatMessageSourceType = 'chat_message' as const
export const chatMessageRoles = ['attachment', 'tool_output'] as const
export const chatMessageRoleSchema = z.enum(chatMessageRoles)
export const chatMessageRefFields = {
  sourceType: z.literal(chatMessageSourceType),
  sourceId: MessageIdSchema,
  role: chatMessageRoleSchema
}
export const chatMessageFileRefSchema = createRefSchema(chatMessageRefFields)

// ─── agent_session_message variant ───

export const agentSessionMessageSourceType = 'agent_session_message' as const
export const agentSessionMessageRoles = ['attachment'] as const
export const agentSessionMessageRoleSchema = z.enum(agentSessionMessageRoles)
export const agentSessionMessageRefFields = {
  sourceType: z.literal(agentSessionMessageSourceType),
  sourceId: MessageIdSchema,
  role: agentSessionMessageRoleSchema
}
export const agentSessionMessageFileRefSchema = createRefSchema(agentSessionMessageRefFields)

// ─── painting variant ───

export const paintingSourceType = 'painting' as const
export const paintingRoles = ['output', 'input'] as const
export const paintingRoleSchema = z.enum(paintingRoles)
export const paintingRefFields = {
  sourceType: z.literal(paintingSourceType),
  sourceId: z.uuidv4(),
  role: paintingRoleSchema
}
export const paintingFileRefSchema = createRefSchema(paintingRefFields)

// ─── job variant ───

export const jobSourceType = 'job' as const
export const jobRoles = ['input', 'mask'] as const
export const jobRoleSchema = z.enum(jobRoles)
export const jobRefFields = {
  sourceType: z.literal(jobSourceType),
  sourceId: z.uuid(),
  role: jobRoleSchema
}
export const jobFileRefSchema = createRefSchema(jobRefFields)

// ─── translate_history variant ───

export const translateHistorySourceType = 'translate_history' as const
export const translateHistoryRoles = ['source', 'target'] as const
export const translateHistoryRoleSchema = z.enum(translateHistoryRoles)
export type TranslateHistoryFileRole = z.infer<typeof translateHistoryRoleSchema>
export const translateHistoryRefFields = {
  sourceType: z.literal(translateHistorySourceType),
  sourceId: z.uuid(),
  role: translateHistoryRoleSchema
}
export const translateHistoryFileRefSchema = createRefSchema(translateHistoryRefFields)

// ─── Roleless single-file variants ───

/** Define a roleless single-file ref variant for one source type. */
function defineSingleFileRef<const T extends string>(sourceType: T) {
  const refFields = {
    sourceType: z.literal(sourceType),
    sourceId: z.string().min(1)
  }
  return { sourceType, refFields, schema: z.object({ ...refCommonFields, ...refFields }) } as const
}

export const providerLogoRef = defineSingleFileRef('provider_logo')
export const miniAppLogoRef = defineSingleFileRef('mini_app_logo')
export const assistantAvatarRef = defineSingleFileRef('assistant_avatar')
export const agentAvatarRef = defineSingleFileRef('agent_avatar')

/** Prefix tagging an uploaded user-profile avatar in the `app.user.avatar` preference. */
export const STORED_FILE_REF_PREFIX = 'file:'

/** Tag a file-entry id as a stored-file reference for an owner's display value. */
export function tagStoredFileRef(id: string): string {
  return `${STORED_FILE_REF_PREFIX}${id}`
}

// ─── Aggregate source type and discriminated union ───

export const allSourceTypes = [
  tempSessionSourceType,
  chatMessageSourceType,
  agentSessionMessageSourceType,
  paintingSourceType,
  jobSourceType,
  translateHistorySourceType,
  providerLogoRef.sourceType,
  miniAppLogoRef.sourceType,
  assistantAvatarRef.sourceType,
  agentAvatarRef.sourceType
] as const satisfies readonly string[]
export type FileRefSourceType = (typeof allSourceTypes)[number]

export const FileRefSourceTypeSchema = z.enum(allSourceTypes)

export const FileRefSchema = z.discriminatedUnion('sourceType', [
  tempSessionFileRefSchema,
  chatMessageFileRefSchema,
  agentSessionMessageFileRefSchema,
  paintingFileRefSchema,
  jobFileRefSchema,
  translateHistoryFileRefSchema,
  providerLogoRef.schema,
  miniAppLogoRef.schema,
  assistantAvatarRef.schema,
  agentAvatarRef.schema
])
export type FileRef = z.infer<typeof FileRefSchema>
