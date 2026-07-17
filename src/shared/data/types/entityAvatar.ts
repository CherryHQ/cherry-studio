import * as z from 'zod'

import { FileEntryIdSchema } from './fileEntryId'

export const EmojiEntityAvatarSchema = z.strictObject({
  kind: z.literal('emoji'),
  emoji: z.emoji()
})

export const ImageEntityAvatarSchema = z.strictObject({
  kind: z.literal('image'),
  fileId: FileEntryIdSchema,
  src: z.string().min(1)
})

/** The single active avatar representation returned by entity read APIs. */
export const EntityAvatarSchema = z.discriminatedUnion('kind', [EmojiEntityAvatarSchema, ImageEntityAvatarSchema])
export type EntityAvatar = z.infer<typeof EntityAvatarSchema>

/** DB-only image binding accepted by create APIs; no filesystem side effect is involved. */
export const EntityAvatarInputSchema = z.discriminatedUnion('kind', [
  EmojiEntityAvatarSchema,
  z.strictObject({ kind: z.literal('image'), fileId: FileEntryIdSchema })
])
export type EntityAvatarInput = z.infer<typeof EntityAvatarInputSchema>
