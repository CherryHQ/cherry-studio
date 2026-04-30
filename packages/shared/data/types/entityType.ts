import * as z from 'zod'

import { UniqueModelIdSchema } from './model'

/**
 * Canonical set of entity types that participate in cross-cutting features
 * (tagging, grouping, pinning). Single source of truth for schema validation
 * of entityType discriminators. DB storage is still `text()` on each table —
 * this enum enforces the value at the API boundary via Zod.
 *
 * Design note (intentionally flat, shared across tag/group/pin):
 * - All three features share this enum and `EntityIdSchema` below. Adding a
 *   value here opens it to all three at the schema boundary — there is no
 *   per-feature gating and no cross-field check between entityType and entityId.
 * - Cross-field correctness is a renderer-hook contract: each feature's hook
 *   (`usePins`, `useTags`, `useGroups`, ...) emits the entityId shape that
 *   matches its entityType. The schema does not re-verify this.
 * - The DB and downstream services tolerate stray combinations gracefully:
 *   pin / entity_tag / group rows have no FK to consumer tables, so an orphan
 *   row from a misuse just renders as an unresolved item the user can remove.
 * - This is deliberate: internal DataApi callers are our own typed renderer code,
 *   so we trust the renderer-side contract instead of paying for a second layer
 *   of schema-level cross-field validation.
 */
export const EntityTypeSchema = z.enum(['assistant', 'topic', 'model', 'agent'])
export type EntityType = z.infer<typeof EntityTypeSchema>

/**
 * Canonical ID schema for any entity referenced polymorphically
 * (entity_tag, pin, group, ...). Accepts:
 * - UUID v4 — current default for assistant / topic / group / pin tables
 *   (`uuidPrimaryKey()` helper)
 * - UUID v7 — used by tables that benefit from time-ordered inserts
 *   (`uuidPrimaryKeyOrdered()` helper);
 * - UniqueModelId — `providerId::modelId` composite for model pins
 *
 * See the design note on EntityTypeSchema above for why no `entityType ↔ entityId`
 * cross-check.
 */
export const EntityIdSchema = z.union([z.uuidv4(), z.uuidv7(), UniqueModelIdSchema])
