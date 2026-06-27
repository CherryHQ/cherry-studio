import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Profile IPC schemas — the user-profile fields owned by the main process.
 *
 * `set_avatar` is the avatar owner: it orchestrates the on-disk file + the
 * `app.user.avatar` Preference atomically, so the renderer never deals with
 * file_entry ids directly.
 *
 * - `{ kind: 'image', data }` — a pre-encoded WebP upload, stored on disk as a
 *   `file_entry`; the preference is set to the new file-entry id.
 * - `{ kind: 'value', value }` — an emoji / preset / `''` (reset), stored
 *   verbatim in the preference.
 */
export const profileRequestSchemas = {
  'profile.set_avatar': defineRoute({
    input: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('image'), data: z.instanceof(Uint8Array) }),
      z.strictObject({ kind: z.literal('value'), value: z.string() })
    ]),
    output: z.void()
  })
}
