/**
 * Knowledge-item file reference variant
 *
 * Links a FileEntry to a `knowledge_item` row in the v2 knowledge subsystem
 * (already on SQLite, UUIDv7 primary key via `uuidPrimaryKeyOrdered`). The
 * owning service writes refs when an item ingests a file (file / sitemap /
 * note / etc.). The corresponding `knowledgeItemChecker` (in
 * `FileRefCheckerRegistry`) is a real DB-backed checker; this schema is the
 * type/validation half of the same wiring.
 *
 * ## Role semantics
 *
 * `sourceId` is strict (`z.uuidv7()`) — `knowledge_item.id` is v2-native, so
 * there is no legacy format risk.
 *
 * `source` marks the user-provided source document for the `knowledge_item`
 * row. `processed_artifact` marks a Cherry-owned derived document produced
 * from that source, such as FileProcessing markdown used for indexing.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const knowledgeItemSourceType = 'knowledge_item' as const

export const knowledgeItemRoles = ['source', 'processed_artifact'] as const
export const knowledgeItemRoleSchema = z.enum(knowledgeItemRoles)
export type KnowledgeItemFileRefRole = (typeof knowledgeItemRoles)[number]

export const knowledgeItemRefFields = {
  sourceType: z.literal(knowledgeItemSourceType),
  sourceId: z.uuidv7(),
  role: knowledgeItemRoleSchema
}

export const knowledgeItemFileRefSchema = createRefSchema(knowledgeItemRefFields)
