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
 * ## Role is a placeholder
 *
 * `sourceId` is strict (`z.uuidv7()`) — `knowledge_item.id` is v2-native, so
 * there is no legacy format risk.
 *
 * `role` is typed as `z.string().min(1)` rather than a closed `z.enum([...])`
 * because KnowledgeService has not yet finalised its role vocabulary. Phase 2
 * wiring will replace this with the concrete enum (e.g. `'attachment' |
 * 'source' | 'preview'`). Tightening from "any non-empty string" to a closed
 * enum is strict-direction migration: pre-existing rows with role values
 * outside the new enum will surface as `ZodError`, which is the desired
 * signal to clean them up.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const knowledgeItemSourceType = 'knowledge_item' as const

/**
 * Placeholder — non-empty string. Phase 2 KnowledgeService will replace this
 * with the concrete role enum once the v2 wiring lands.
 */
export const knowledgeItemRoleSchema = z.string().min(1)

export const knowledgeItemRefFields = {
  sourceType: z.literal(knowledgeItemSourceType),
  sourceId: z.uuidv7(),
  role: knowledgeItemRoleSchema
}

export const knowledgeItemFileRefSchema = createRefSchema(knowledgeItemRefFields)
