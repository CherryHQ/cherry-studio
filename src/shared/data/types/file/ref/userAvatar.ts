/**
 * User avatar file reference variant
 *
 * Links a FileEntry (a normalized 128×128 WebP) to the singleton user avatar.
 * The `app.user.avatar` preference stores the same file-entry id for display;
 * this `file_ref` owns the file's lifecycle.
 *
 * The avatar is a singleton, so `sourceId` is the constant `'default'`.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const userAvatarSourceType = 'user_avatar' as const

/** Singleton — there is one user avatar. */
export const USER_AVATAR_SOURCE_ID = 'default' as const

export const userAvatarRoles = ['avatar'] as const
export const userAvatarRoleSchema = z.enum(userAvatarRoles)

export const userAvatarRefFields = {
  sourceType: z.literal(userAvatarSourceType),
  sourceId: z.string().min(1),
  role: userAvatarRoleSchema
}

export const userAvatarFileRefSchema = createRefSchema(userAvatarRefFields)
