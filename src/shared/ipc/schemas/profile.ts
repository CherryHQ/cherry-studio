import { FileEntryIdSchema } from '@shared/data/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Profile IPC schemas — the user-profile fields owned by the main process.
 *
 * `set_avatar` is the avatar owner: DB-only. It reconciles the `user_avatar`
 * single-file `file_ref` slot and the `app.user.avatar` Preference, so the
 * renderer expresses intent (a pre-stored file id, or an emoji/reset value)
 * without touching `file_ref` slot details or the filesystem.
 *
 * - `{ kind: 'file', fileId }` — an opaque file-entry id the renderer pre-stored
 *   (via `file.batch_create_internal_entries`); the slot ref points at it and
 *   the preference is set to it.
 * - `{ kind: 'value', value }` — an emoji / preset / `''` (reset); the slot ref
 *   is cleared and the value stored verbatim in the preference.
 */
export const profileRequestSchemas = {
  'profile.set_avatar': defineRoute({
    input: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('file'), fileId: FileEntryIdSchema }),
      z.strictObject({ kind: z.literal('value'), value: z.string() })
    ]),
    output: z.void()
  })
}
