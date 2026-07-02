import * as z from 'zod'

import { defineRoute } from '../define'
import { ImageBytesSchema } from './entityImage'

/**
 * Profile IPC schemas — the user-profile fields owned by the main process.
 *
 * `set_avatar` is the avatar owner. Like provider / mini-app logos, an uploaded
 * avatar is sent as **raw bytes**; the handler normalizes to a 128×128 WebP,
 * creates the `file_entry`, points the `user_avatar` `file_ref` slot at it, and
 * stores a `file:<id>` ref in `app.user.avatar` (compensating on failure). The
 * non-image cases are a typed union — no arbitrary `value: string`.
 *
 * - `{ kind: 'image', data }` — raw upload bytes; main creates + binds the file.
 * - `{ kind: 'emoji', emoji }` — an emoji glyph, stored verbatim; slot cleared.
 * - `{ kind: 'clear' }` — reset to the bundled default (`''`); slot cleared.
 */
export const profileRequestSchemas = {
  'profile.set_avatar': defineRoute({
    input: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
      z.strictObject({ kind: z.literal('emoji'), emoji: z.string().min(1) }),
      z.strictObject({ kind: z.literal('clear') })
    ]),
    output: z.void()
  })
}
