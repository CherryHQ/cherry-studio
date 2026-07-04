/**
 * Single-file FileRef variants — provider logo / mini-app logo.
 *
 * These model a **single-file** reference: one owner entity holds at most ONE
 * file for a given role, set-replaces the previous one, and exclusively owns it
 * — in contrast to the *collection* refs (`chat_message` attachments,
 * `knowledge_item` sources, `painting` outputs/inputs) which are 1:N.
 *
 * Both are structurally identical (free-string `sourceId`, a single role),
 * so one factory defines them instead of duplicate variant files. The owning
 * business owner (the provider/mini-app DataApi service) decides the slot and
 * manages the `file_ref` row server-side; the renderer never sees
 * `sourceType`/`sourceId`/`role`. (The user avatar deliberately has NO ref
 * variant — it is persisted only as a tagged value in the `app.user.avatar`
 * preference; see `profile.set_avatar`.)
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

/**
 * Define a single-file `file_ref` variant for `sourceType`. `sourceId` is a
 * free-form string (provider / app ids are opaque). These variants are
 * **roleless**: an owner holds at most one file for one implicit purpose, so a
 * `role` column would be a constant carrying no information and is dropped
 * (nothing downstream reads it). Returns the source-type literal, ref fields,
 * and the assembled discriminated-union member schema.
 */
export function defineSingleFileRef<const T extends string>(sourceType: T) {
  const refFields = {
    sourceType: z.literal(sourceType),
    sourceId: z.string().min(1)
  }
  return { sourceType, refFields, schema: createRefSchema(refFields) } as const
}

export const providerLogoRef = defineSingleFileRef('provider_logo')
export const miniAppLogoRef = defineSingleFileRef('mini_app_logo')

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
