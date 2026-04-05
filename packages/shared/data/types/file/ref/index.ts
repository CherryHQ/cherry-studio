import * as z from 'zod'

import { exampleFileRefSchema, exampleRoles, exampleSourceType } from './example'

const allSourceTypes = [exampleSourceType] as const

const allRoles = [...exampleRoles] as const

/**
 * Business source type that references files.
 * Currently only contains placeholder `example`.
 * Planned Phase 2 values: `chat_message`, `knowledge_item`, `painting`, `note`
 *
 * TODO(phase-2): Replace 'example' with real source types as each business module integrates with file refs
 */
export const FileRefSourceTypeSchema = z.enum(allSourceTypes)
export type FileRefSourceType = z.infer<typeof FileRefSourceTypeSchema>

/**
 * File reference role — scoped per sourceType.
 * Currently only contains placeholder `role`.
 * Planned Phase 2 values: `attachment`, `source`, `asset`, `embed` (varying by sourceType)
 *
 * TODO(phase-2): Each sourceType defines its own role set. When adding a real sourceType,
 * define its roles in a dedicated ref file (see ref/example.ts as template) and spread them here
 */
export const FileRefRoleSchema = z.enum(allRoles)
export type FileRefRole = z.infer<typeof FileRefRoleSchema>

/** File reference entity — tracks business entity to file node relationships */
export const FileRefSchema = z.discriminatedUnion('sourceType', [exampleFileRefSchema])
export type FileRef = z.infer<typeof FileRefSchema>
