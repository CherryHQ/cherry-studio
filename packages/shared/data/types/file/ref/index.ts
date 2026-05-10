/**
 * FileRef aggregated schema
 *
 * Combines all business-domain ref variants into a single discriminated union.
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

import { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType } from './tempSession'

// ─── SourceType type (load-bearing — keys the OrphanRefScanner registry) ───

/**
 * All expected FileRef source types — the complete type union.
 *
 * The tuple form is required so `FileRefSourceType` infers as a union of
 * string literals rather than `string` — this lets `Record<FileRefSourceType, …>`
 * enforce exhaustive coverage at compile time. OrphanRefScanner's checker
 * registry uses this property: a new variant in `allSourceTypes` without a
 * matching `SourceTypeChecker` is a compile error.
 *
 * ## Variant registration status
 *
 * - `temp_session` — full Zod schema variant landed (`./tempSession.ts`).
 *   Transient paste/draft refs.
 * - `chat_message` / `knowledge_item` / `painting` / `note` — tuple entry only;
 *   the discriminated `FileRefSchema` union does not yet include their
 *   variant schemas. `OrphanRefScanner` ships a conservative no-op stub
 *   checker for each so the type union and the runtime registry stay in sync;
 *   the real checkers come online when the owning DB tables migrate to v2.
 *
 * The type union stays complete now so registries keyed by `FileRefSourceType`
 * (OrphanRefScanner, DataApi param typing) do not change when new variants
 * land — only the `FileRefSchema` discriminated union grows additively.
 */
export const allSourceTypes = [
  tempSessionSourceType,
  'chat_message',
  'knowledge_item',
  'painting',
  'note'
] as const satisfies readonly string[]
export type FileRefSourceType = (typeof allSourceTypes)[number]

// ─── Discriminated Union ───

/**
 * Runtime-validated FileRef schema. Today only `tempSession` is registered;
 * other variants listed in `FileRefSourceType` are intentionally absent here
 * until their schema files land. Constructing a FileRef for an unregistered
 * sourceType via `FileRefSchema.parse` will throw — which is the desired
 * behavior (current producers are restricted to tempSession refs).
 */
export const FileRefSchema = z.discriminatedUnion('sourceType', [tempSessionFileRefSchema])
export type FileRef = z.infer<typeof FileRefSchema>

// ─── Re-exports ───

export { tempSessionFileRefSchema, tempSessionRefFields, tempSessionRoles, tempSessionSourceType }
