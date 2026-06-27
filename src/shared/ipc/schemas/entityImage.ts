import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Preset icon id / `icon:<id>` ref. Mirrors `LogoKeySchema` in
 * `@shared/data/api/schemas/logo` (kept local so the IPC schema graph does not
 * depend on the DataApi DTO module and its `file_entry` brand) — including the
 * rejection of `data:` / `file:` refs so a key can never smuggle inline bytes or
 * a stored-file ref into `logo_key`.
 */
const LogoKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => !/^(data:|file:)/i.test(v), 'logo key must not be a data: or file: ref')

/**
 * Entity-image set commands (provider / mini-app logo; the avatar variant lives
 * in `profile.ts`). The renderer sends **business intent + raw bytes**; the main
 * handler normalizes to a 128×128 WebP, creates the `file_entry`, binds it via
 * the owner's single-file `file_ref` slot, and compensates (permanentDelete) on
 * bind failure. No `file_entry` is ever created in the renderer.
 */

/** Max raw upload accepted (pre-normalization); sharp downsizes to 128² regardless. */
export const MAX_ENTITY_IMAGE_BYTES = 16 * 1024 * 1024

/** Raw uploaded image bytes — a non-empty `Uint8Array` within the size cap. */
export const ImageBytesSchema = z
  .instanceof(Uint8Array)
  .refine((u) => u.byteLength > 0 && u.byteLength <= MAX_ENTITY_IMAGE_BYTES, 'image bytes out of range')

/**
 * Logo intent for a set-logo command: raw image bytes (main creates the file),
 * a preset key (stored on `logoKey`), or clear (reset to the bundled icon).
 */
export const LogoImageIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
  z.strictObject({ kind: z.literal('key'), key: LogoKeySchema }),
  z.strictObject({ kind: z.literal('clear') })
])
export type LogoImageIntent = z.infer<typeof LogoImageIntentSchema>

export const entityImageRequestSchemas = {
  'provider.set_logo': defineRoute({
    input: z.strictObject({ providerId: z.string().min(1), image: LogoImageIntentSchema }),
    output: z.void()
  }),
  'mini_app.set_logo': defineRoute({
    input: z.strictObject({ appId: z.string().min(1), image: LogoImageIntentSchema }),
    output: z.void()
  })
}
