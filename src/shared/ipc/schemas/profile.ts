import * as z from 'zod'

import { defineRoute } from '../define'
import { ImageBytesSchema } from './entityImage'

/**
 * Profile IPC schemas — the user-profile fields owned by the main process.
 *
 * `set_avatar` is the avatar owner. Like provider / mini-app logos, an uploaded
 * avatar is sent as **raw bytes**; the handler normalizes to a 128×128 WebP,
 * creates the `file_entry`, and stores a `file:<id>` ref in the
 * `app.user.avatar` preference (compensating on failure) — the preference is
 * the avatar's only persisted copy; there is no `file_ref` row for it. The
 * non-image cases are a typed union — no arbitrary `value: string`.
 *
 * - `{ kind: 'image', data }` — raw upload bytes; main creates + binds the file.
 * - `{ kind: 'emoji', emoji }` — an emoji glyph, stored verbatim; slot cleared.
 * - `{ kind: 'default' }` — reset to the bundled default (`''`); slot cleared.
 */
export const profileRequestSchemas = {
  'profile.set_avatar': defineRoute({
    input: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
      z.strictObject({ kind: z.literal('emoji'), emoji: z.string().min(1) }),
      z.strictObject({ kind: z.literal('default') })
    ]),
    output: z.void()
  })
}
