import * as z from 'zod'

/**
 * Shared entity-image schema atoms — the `LogoImageIntent` union and its byte
 * guard, reused by the per-domain set-logo commands (`provider.set_logo` in
 * `./provider`, `mini_app.set_logo` in `./miniApp`). The routes live in those
 * domain files; this module holds only the shared pieces.
 */

/**
 * Preset icon id / `icon:<id>` ref. Mirrors `LogoKeySchema` in
 * `@shared/data/api/schemas/logo` (kept local so the IPC schema graph does not
 * depend on the DataApi DTO module and its `file_entry` brand) — including the
 * rejection of `data:` / `file:` / `http(s):` refs so a key can never smuggle
 * inline bytes, a stored-file ref, or a remote-image URL into `logo_key`.
 */
const LogoKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => !/^(data:|file:|https?:)/i.test(v), 'logo key must not be a data:, file:, or http(s): ref')

/**
 * Max image bytes accepted over IPC. The renderer normalizes uploads to a 128×128
 * WebP (tens of KB) before sending, so this is a tight defense-in-depth bound on the
 * already-processed payload, not the original file size.
 */
export const MAX_ENTITY_IMAGE_BYTES = 1024 * 1024

/** Normalized image bytes — a non-empty `Uint8Array` within the size cap. */
export const ImageBytesSchema = z
  .instanceof(Uint8Array)
  .refine((u) => u.byteLength > 0 && u.byteLength <= MAX_ENTITY_IMAGE_BYTES, 'image bytes out of range')

/**
 * Logo intent for a set-logo command: raw image bytes (main creates the file),
 * a preset key (stored on `logoKey`), or default (reset to the bundled icon).
 */
export const LogoImageIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
  z.strictObject({ kind: z.literal('key'), key: LogoKeySchema }),
  z.strictObject({ kind: z.literal('default') })
])
export type LogoImageIntent = z.infer<typeof LogoImageIntentSchema>
