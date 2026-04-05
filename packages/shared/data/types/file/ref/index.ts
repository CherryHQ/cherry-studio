/**
 * FileRef aggregated schema
 *
 * Combines all business-domain ref variants into a single discriminated union.
 * To add a new variant, see README.md in this directory.
 */

import * as z from 'zod'

import { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType } from './tempSession'

// ─── Aggregate Source Types ───

const allSourceTypes = [tempSessionSourceType] as const
export const FileRefSourceTypeSchema = z.enum(allSourceTypes)
export type FileRefSourceType = z.infer<typeof FileRefSourceTypeSchema>

// ─── Aggregate Roles ───

const allRoles = [...tempSessionRoles] as const
export const FileRefRoleSchema = z.enum(allRoles)
export type FileRefRole = z.infer<typeof FileRefRoleSchema>

// ─── Discriminated Union ───

export const FileRefSchema = z.discriminatedUnion('sourceType', [tempSessionFileRefSchema])
export type FileRef = z.infer<typeof FileRefSchema>

// ─── Re-exports ───

export { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType }
