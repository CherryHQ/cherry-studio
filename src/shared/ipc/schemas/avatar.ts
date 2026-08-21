import * as z from 'zod'

import { IconImageBytesSchema } from './iconImage'

/** Mutually exclusive Assistant/Agent avatar write intent. */
export const SetAvatarIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), data: IconImageBytesSchema }),
  z.strictObject({ kind: z.literal('emoji'), emoji: z.emoji() })
])
export type SetAvatarIntent = z.infer<typeof SetAvatarIntentSchema>
