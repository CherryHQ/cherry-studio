/**
 * FileRef aggregated schema
 *
 * Combines all currently-registered business-domain ref variants into a
 * single discriminated union.
 *
 * ## Adding a new variant (e.g. `chat_message`)
 *
 * 1. Create `./chatMessage.ts` following `./tempSession.ts` as a template —
 *    declare `chatMessageSourceType`, `chatMessageRoles`, `chatMessageRefFields`,
 *    and export `chatMessageFileRefSchema = createRefSchema(chatMessageRefFields)`
 * 2. In this file: import the three symbols (source type literal, roles tuple,
 *    schema) and add the source type literal to `allSourceTypes`, then add the
 *    schema to the `FileRefSchema` discriminated union
 * 3. Register a `SourceTypeChecker` in `OrphanRefScanner` (main-side) — the
 *    registry type `Record<FileRefSourceType, SourceTypeChecker>` compile-time
 *    enforces that every sourceType has a checker; missing one = type error
 * 4. In the owning business service's delete flow, call
 *    `fileRefService.cleanupBySource(sourceType, sourceId)` — the pull-model
 *    cleanup. OrphanRefScanner is the safety net for missed paths.
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
  knowledgeItemFileRefSchema,
  knowledgeItemRefFields,
  knowledgeItemRoles,
  knowledgeItemRoleSchema,
  knowledgeItemSourceType
} from './knowledgeItem'
import { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType } from './tempSession'

// ─── SourceType type (load-bearing — keys the OrphanRefScanner registry) ───

/**
 * All currently-registered FileRef source types — the complete type union.
 *
 * The tuple form is required so `FileRefSourceType` infers as a union of
 * string literals rather than `string` — this lets `Record<FileRefSourceType, …>`
 * enforce exhaustive coverage at compile time. OrphanRefScanner's checker
 * registry uses this property: a new variant in `allSourceTypes` without a
 * matching `SourceTypeChecker` is a compile error.
 *
 * ## Currently registered variants
 *
 * - `temp_session` — transient paste/draft refs (`./tempSession.ts`).
 * - `knowledge_item` — refs from `knowledge_item` rows (`./knowledgeItem.ts`).
 *   `role` is a single-element placeholder enum; KnowledgeService wiring will
 *   extend it once the role vocabulary settles. No production code currently
 *   writes `knowledge_item` refs, so the choice of placeholder value
 *   (`'attachment'`) is inconsequential.
 *
 * Other business domains (chat_message / painting / note) deliberately do
 * NOT appear here. They will be added when their owning DB tables migrate
 * to v2 — at which point each variant gains its tuple entry, its
 * `createRefSchema` variant, AND its `SourceTypeChecker` in one PR. Keeping
 * those three surfaces in lockstep prevents the "type declared but schema
 * unaware" gap.
 */
export const allSourceTypes = [tempSessionSourceType, knowledgeItemSourceType] as const satisfies readonly string[]
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
export const FileRefSchema = z.discriminatedUnion('sourceType', [tempSessionFileRefSchema, knowledgeItemFileRefSchema])
export type FileRef = z.infer<typeof FileRefSchema>

// ─── Re-exports ───

export {
  knowledgeItemFileRefSchema,
  knowledgeItemRefFields,
  knowledgeItemRoles,
  knowledgeItemRoleSchema,
  knowledgeItemSourceType,
  tempSessionFileRefSchema,
  tempSessionRefFields,
  tempSessionRoles,
  tempSessionSourceType
}
