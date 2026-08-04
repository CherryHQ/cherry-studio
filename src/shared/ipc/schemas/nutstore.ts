import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Nutstore account access.
 *
 * THE ACCESS TOKEN NEVER CROSSES THIS BOUNDARY. The renderer holds only the
 * encrypted blob the SSO redirect gave it, in Preference; main reads that,
 * decrypts it, and talks to Nutstore itself. The channels this replaces did the
 * opposite — they handed the decrypted token out for display and took it back as
 * an argument on every directory call.
 */

/** One entry in a Nutstore directory, as the path picker renders it. */
const NutstoreEntrySchema = z.strictObject({
  path: z.string(),
  basename: z.string(),
  isDir: z.boolean(),
  /** Epoch millis. */
  mtime: z.number().int().nonnegative(),
  size: z.number().int().nonnegative()
})

const RemotePathSchema = z.strictObject({ path: z.string().min(1).max(1024) })

export const nutstoreRequestSchemas = {
  /** Who is signed in, for display. `null` when no usable token is stored. */
  'nutstore.get_account': defineRoute({
    input: z.void(),
    output: z.nullable(z.strictObject({ username: z.string() }))
  }),
  'nutstore.list_directory': defineRoute({
    input: RemotePathSchema,
    output: z.array(NutstoreEntrySchema)
  }),
  /** Creates missing parents too — the picker offers a free-text new folder. */
  'nutstore.create_directory': defineRoute({
    input: RemotePathSchema,
    output: z.void()
  })
}
