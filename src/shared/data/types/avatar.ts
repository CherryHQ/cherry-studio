import * as z from 'zod'

import { FileEntryIdSchema } from './file'

export const EmojiAvatarValueSchema = z.strictObject({
  kind: z.literal('emoji'),
  emoji: z.emoji()
})

export const ImageAvatarValueSchema = z.strictObject({
  kind: z.literal('image'),
  fileId: FileEntryIdSchema,
  src: z.string().min(1)
})

/** The single active avatar representation returned by Assistant/Agent read APIs. */
export const AvatarValueSchema = z.discriminatedUnion('kind', [EmojiAvatarValueSchema, ImageAvatarValueSchema])
export type AvatarValue = z.infer<typeof AvatarValueSchema>

/** DB-only image binding accepted by create APIs; no filesystem side effect is involved. */
export const AvatarInputSchema = z.discriminatedUnion('kind', [
  EmojiAvatarValueSchema,
  z.strictObject({ kind: z.literal('image'), fileId: FileEntryIdSchema })
])
export type AvatarInput = z.infer<typeof AvatarInputSchema>
