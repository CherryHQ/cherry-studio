/**
 * Single-file FileRef variants — avatar / provider logo / mini-app logo.
 *
 * These model a **single-file** reference: one owner entity holds at most ONE
 * file for a given role, set-replaces the previous one, and exclusively owns it
 * — in contrast to the *collection* refs (`chat_message` attachments,
 * `knowledge_item` sources, `painting` outputs/inputs) which are 1:N.
 *
 * All three are structurally identical (free-string `sourceId`, a single role),
 * so one factory defines them instead of duplicate variant files. The owning
 * business owner (the provider/mini-app DataApi service, or the avatar IPC
 * handler) decides the slot and manages the `file_ref` row server-side; the
 * renderer never sees `sourceType`/`sourceId`/`role`.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

/**
 * Define a single-file `file_ref` variant for `sourceType` with the given
 * `roles`. `sourceId` is a free-form string (provider/app/avatar ids are
 * opaque). Returns the source-type literal, roles tuple, role schema, ref
 * fields, and the assembled discriminated-union member schema.
 */
export function defineSingleFileRef<const T extends string, const R extends readonly [string, ...string[]]>(
  sourceType: T,
  roles: R
) {
  const roleSchema = z.enum(roles)
  const refFields = {
    sourceType: z.literal(sourceType),
    sourceId: z.string().min(1),
    role: roleSchema
  }
  return { sourceType, roles, roleSchema, refFields, schema: createRefSchema(refFields) } as const
}

export const providerLogoRef = defineSingleFileRef('provider_logo', ['logo'])
export const miniAppLogoRef = defineSingleFileRef('mini_app_logo', ['logo'])
export const userAvatarRef = defineSingleFileRef('user_avatar', ['avatar'])

/** The avatar is a singleton — there is one user avatar, keyed by this constant. */
export const USER_AVATAR_SOURCE_ID = 'default'

/**
 * Prefix tagging an uploaded entity image in its owner's **display value**
 * (`provider.logo` / `miniApp.logo` / the `app.user.avatar` preference), e.g.
 * `file:0190f3c4-…`. The owner's API tags an uploaded file this way so the
 * renderer's `resolveStoredImageSrc` resolves it by prefix (→ `file://…/{id}.webp`)
 * instead of guessing from the value's shape; every other form (icon ref / emoji
 * / preset id) passes through. Distinct from an already-resolved `file://…` URL.
 */
export const STORED_FILE_REF_PREFIX = 'file:'

/** Tag a file-entry id as a stored-image reference for an owner's display value. */
export function tagStoredFileRef(id: string): string {
  return `${STORED_FILE_REF_PREFIX}${id}`
}
