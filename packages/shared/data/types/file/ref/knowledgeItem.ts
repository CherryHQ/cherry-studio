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
 * Phase 2 KnowledgeService finalises its full vocabulary (likely something
 * like `['attachment', 'source', 'preview']`). Phase 2 expansion is a pure
 * additive change: existing rows whose role is in the new enum keep working,
 * and any row carrying a role outside the new enum surfaces as `ZodError`
 * (the desired clean-up signal). The current PR has no real caller writing
 * `knowledge_item` refs yet, so the specific placeholder value is
 * inconsequential — picking the most likely future-superset member.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const knowledgeItemSourceType = 'knowledge_item' as const

/**
 * Single-element placeholder enum — Phase 2 KnowledgeService will extend
 * this with the rest of its role vocabulary.
 */
export const knowledgeItemRoles = ['attachment'] as const
export const knowledgeItemRoleSchema = z.enum(knowledgeItemRoles)

export const knowledgeItemRefFields = {
  sourceType: z.literal(knowledgeItemSourceType),
  sourceId: z.uuidv7(),
  role: knowledgeItemRoleSchema
}

export const knowledgeItemFileRefSchema = createRefSchema(knowledgeItemRefFields)
