import { FileEntryIdSchema } from '@shared/data/types/file'
import * as z from 'zod'

/**
 * Entity-logo DTO input (provider / mini-app), modeled as a discriminated union
 * so a caller picks **exactly one** of a preset key or a pre-stored upload —
 * the two can never be set together. Mirrors the avatar `profile.set_avatar`
 * convention (`{ kind: ... }`).
 *
 * - `{ kind: 'key', key }`  → preset icon id / `icon:<id>` ref, stored inline
 *   on the owner row's `logoKey` column. Never a remote URL or data URL — an
 *   uploaded image goes through `kind: 'file'`.
 * - `{ kind: 'file', fileId }` → opaque file-entry id the renderer pre-stored
 *   (via `file.batch_create_internal_entries`); stored on `logoFileId`.
 * - `{ kind: 'clear' }` → reset to no custom logo (update only).
 *
 * The column pair `(logoKey, logoFileId)` stays flat on the row; the union is
 * the write model only. Reads resolve back to a single `logo` string
 * (`logoFileId ?? logoKey`).
 */

/** Preset icon id / `icon:<id>` ref. Short — uploads use `kind: 'file'`. */
export const LogoKeySchema = z.string().min(1).max(2048)

const LogoKeyVariant = z.strictObject({ kind: z.literal('key'), key: LogoKeySchema })
const LogoFileVariant = z.strictObject({ kind: z.literal('file'), fileId: FileEntryIdSchema })
const LogoClearVariant = z.strictObject({ kind: z.literal('clear') })

/** Logo intent on create — a preset key or a pre-stored upload (omit for none). */
export const CreateLogoSchema = z.discriminatedUnion('kind', [LogoKeyVariant, LogoFileVariant])

/** Logo intent on update — adds `clear` to reset; omit leaves it unchanged. */
export const UpdateLogoSchema = z.discriminatedUnion('kind', [LogoKeyVariant, LogoFileVariant, LogoClearVariant])

export type CreateLogoInput = z.infer<typeof CreateLogoSchema>
export type UpdateLogoInput = z.infer<typeof UpdateLogoSchema>
