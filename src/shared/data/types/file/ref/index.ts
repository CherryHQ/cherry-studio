/**
 * FileRef aggregated schema
 *
 * Combines all currently-registered business-domain ref variants into a
 * single discriminated union.
 *
 * ## Adding a new variant (e.g. `painting`)
 *
 * 1. Create `./painting.ts` following `./tempSession.ts` as a template —
 *    declare `paintingSourceType`, `paintingRoles`, `paintingRefFields`,
 *    and export `paintingFileRefSchema = createRefSchema(paintingRefFields)`
 * 2. In this file: import the three symbols (source type literal, roles tuple,
 *    schema) and add the source type literal to `allSourceTypes`, then add the
 *    schema to the `FileRefSchema` discriminated union
 * 3. Back the persistent variant with an FK-constrained association table so
 *    deleting the owning source cascades refs at the database layer. If the
 *    relationship can be replaced without deleting the source (for example,
 *    editing a painting's input/output files), explicitly delete + insert the
 *    affected association rows in that update flow.
 *
 * ## No global role aggregation
 *
 * Each variant's `role` is validated locally by its own `z.enum(variantRoles)`
 * inside `createRefSchema`. There is no (and should not be) a union of all
 * roles across variants — adding a sourceType changes only (a) the new variant
 * file and (b) two lines in this file. The shared `FileRef` type narrows by
 * `sourceType` via the discriminated union.
 */

import * as z from 'zod'

import {
  chatMessageFileRefSchema,
  chatMessageRefFields,
  chatMessageRoles,
  chatMessageRoleSchema,
  chatMessageSourceType
} from './chatMessage'
import {
  paintingFileRefSchema,
  paintingRefFields,
  paintingRoles,
  paintingRoleSchema,
  paintingSourceType
} from './painting'
import { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType } from './tempSession'

// ─── SourceType type (load-bearing — keys DataApi/query validation) ───

/**
 * All currently-registered FileRef source types — the complete type union.
 *
 * The tuple form is required so `FileRefSourceType` infers as a union of
 * string literals rather than `string`. DataApi handlers and query facades use
 * the same tuple for runtime validation and discriminated-union narrowing.
 *
 * ## Currently registered variants
 *
 * - `temp_session` — transient paste/draft refs (`./tempSession.ts`), backed by
 *   main-process CacheService memory instead of SQLite.
 * - `chat_message` — refs from migrated chat message attachments (`./chatMessage.ts`).
 * - `painting` — refs from `painting` rows (`./painting.ts`), roles
 *   `output`/`input`.
 *
 * Other business domains (note) deliberately do NOT appear here. They will be
 * added when their owning DB tables migrate to v2 — at which point each
 * variant gains its tuple entry, its `createRefSchema` variant, and its
 * FK-constrained association table in one PR. Keeping those surfaces in
 * lockstep prevents the "type declared but schema unaware" gap.
 */
export const allSourceTypes = [
  tempSessionSourceType,
  chatMessageSourceType,
  paintingSourceType
] as const satisfies readonly string[]
export type FileRefSourceType = (typeof allSourceTypes)[number]

/**
 * Runtime validator for `FileRefSourceType` — used by DataApi handlers to
 * guard `sourceType` query parameters before reaching the service. Stays in
 * lockstep with `allSourceTypes` because it derives from the same tuple.
 */
export const FileRefSourceTypeSchema = z.enum(allSourceTypes)

// ─── Discriminated Union ───

/**
 * Runtime-validated FileRef schema covering every variant in `allSourceTypes`.
 * `FileRefSchema.parse` accepts any registered variant and rejects rows
 * whose `sourceType` is not in this union — the desired behavior, because
 * a row with an unregistered sourceType implies either a stale artefact or
 * a bug that bypassed the variant-registration discipline.
 */
export const FileRefSchema = z.discriminatedUnion('sourceType', [
  tempSessionFileRefSchema,
  chatMessageFileRefSchema,
  paintingFileRefSchema
])
export type FileRef = z.infer<typeof FileRefSchema>

// ─── Re-exports ───

export {
  chatMessageFileRefSchema,
  chatMessageRefFields,
  chatMessageRoles,
  chatMessageRoleSchema,
  chatMessageSourceType,
  paintingFileRefSchema,
  paintingRefFields,
  paintingRoles,
  paintingRoleSchema,
  paintingSourceType,
  tempSessionFileRefSchema,
  tempSessionRefFields,
  tempSessionRoles,
  tempSessionSourceType
}
