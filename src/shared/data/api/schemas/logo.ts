import * as z from 'zod'

import { LogoKeySchema } from './logoKey'

/**
 * Renderer-facing entity-logo create schema (provider / mini-app).
 *
 * Only a preset key is expressible here. A custom *uploaded* logo is NOT part of
 * a DataApi DTO; uploads (and all logo *edits*) go through the dedicated IpcApi
 * commands `provider.set_logo` / `mini_app.set_logo`, which take bytes, create
 * the `file_entry` main-side, and bind it — which is why DataApi services never
 * see raw bytes (pure DB). The service-internal bind input the command
 * orchestrator hands to `reconcileLogoSlotTx` after minting the `file_entry`
 * lives in the main layer (`LogoBindInput` in `@data/services/utils/entityImageRef`),
 * never here — its `file` variant never originates from the renderer.
 *
 * An uploaded logo lives only in the single-file `file_ref` slot (the source of
 * truth); the owner row keeps just `logoKey`. The DTO exposes `logo` (the key)
 * plus a main-resolved `logoSrc` (the uploaded file's `file://` URL) — mutually
 * exclusive.
 */

/** Renderer-facing create logo — a preset key only (uploads use the set-logo command). */
export const CreateLogoSchema = z.strictObject({ kind: z.literal('key'), key: LogoKeySchema })
export type CreateLogoInput = z.infer<typeof CreateLogoSchema>
