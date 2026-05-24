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
 * ## Role placeholder
 *
 * `sourceId` is strict (`z.uuidv7()`) — `knowledge_item.id` is v2-native, so
 * there is no legacy format risk.
 *
 * `BusinessRefShape` requires `role` to be a `z.ZodEnum`, so this variant
 * ships with a single-element enum `['attachment']` as a placeholder until
 * KnowledgeService finalises its full vocabulary. Extending the enum later
 * is additive: rows whose role falls outside the new set surface as
 * `ZodError`, which is the desired clean-up signal.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const knowledgeItemSourceType = 'knowledge_item' as const

export const knowledgeItemRoles = ['attachment'] as const
export const knowledgeItemRoleSchema = z.enum(knowledgeItemRoles)

export const knowledgeItemRefFields = {
  sourceType: z.literal(knowledgeItemSourceType),
  sourceId: z.uuidv7(),
  role: knowledgeItemRoleSchema
}

export const knowledgeItemFileRefSchema = createRefSchema(knowledgeItemRefFields)
