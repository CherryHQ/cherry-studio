import * as z from 'zod'

import { exampleFileRefSchema, exampleRoles, exampleSourceType } from './example'

const allSourceTypes = [exampleSourceType] as const

const allRoles = [...exampleRoles] as const

/**
 * Business source type that references files.
 * Examples: `chat_message`, `knowledge_item`, `painting`, `note`
 *
 * TODO: Add concrete enum values when Phase 2 business integrations are implemented
 */
export const FileRefSourceTypeSchema = z.enum(allSourceTypes)
export type FileRefSourceType = z.infer<typeof FileRefSourceTypeSchema>

/**
 * File reference role — scoped per sourceType
 * Examples: `attachment`, `source`, `asset`, `embed`
 *
 * TODO: Add concrete enum values when Phase 2 business integrations are implemented
 */
export const FileRefRoleSchema = z.enum(allRoles)
export type FileRefRole = z.infer<typeof FileRefRoleSchema>

/** File reference entity — tracks business entity to file node relationships */
export const FileRefSchema = z.discriminatedUnion('sourceType', [exampleFileRefSchema])
export type FileRef = z.infer<typeof FileRefSchema>
