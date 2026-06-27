import { FileEntryIdSchema } from '@shared/data/types/file'
import * as z from 'zod'

/**
 * Entity-logo schemas (provider / mini-app).
 *
 * Two layers, deliberately split:
 *
 * - **Renderer-facing** ({@link CreateLogoSchema}) — only a preset key. A custom
 *   *uploaded* logo is NOT expressible in a DataApi DTO; uploads (and all logo
 *   *edits*) go through the dedicated IpcApi commands `provider.set_logo` /
 *   `mini_app.set_logo`, which take bytes, create the `file_entry` main-side,
 *   and bind it. This is why DataApi services never see raw bytes (pure DB).
 *
 * - **Service-internal** ({@link LogoBindInputSchema}, key | file | clear) — what
 *   the command orchestrator hands to the service's `reconcileLogoSlotTx` after
 *   it has minted the `file_entry`. The `file` variant only ever originates
 *   main-side, never from the renderer.
 *
 * The flat `(logoKey, logoFileId)` columns and the single-file `file_ref` slot
 * are unchanged; reads resolve to one `logo` string (`logoFileId ?? logoKey`,
 * the former tagged `file:<id>`).
 */

/**
 * Preset icon id / `icon:<id>` ref. Short — uploads go through the set-logo
 * command. Inline bytes (`data:`) and stored-file refs (`file:` / `file://`) are
 * rejected: a key must never carry image bytes or mint a stored-image ref with
 * no `logo_file_id` FK / `file_ref` ownership. Legacy URL/data values stay
 * isolated to the migration/compat boundary, not this write contract.
 */
export const LogoKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => !/^(data:|file:)/i.test(v), 'logo key must not be a data: or file: ref')

const LogoKeyVariant = z.strictObject({ kind: z.literal('key'), key: LogoKeySchema })
const LogoFileVariant = z.strictObject({ kind: z.literal('file'), fileId: FileEntryIdSchema })
const LogoClearVariant = z.strictObject({ kind: z.literal('clear') })

/** Renderer-facing create logo — a preset key only (uploads use the set-logo command). */
export const CreateLogoSchema = LogoKeyVariant
export type CreateLogoInput = z.infer<typeof CreateLogoSchema>

/**
 * Service-internal bind input consumed by `reconcileLogoSlotTx`. `file` is
 * supplied only by the main-side command orchestrator (never the renderer).
 */
export const LogoBindInputSchema = z.discriminatedUnion('kind', [LogoKeyVariant, LogoFileVariant, LogoClearVariant])
export type LogoBindInput = z.infer<typeof LogoBindInputSchema>
