import { LogoKeySchema } from '@shared/data/api/schemas/logoKey'
import * as z from 'zod'

import { IconImageBytesSchema } from './iconImage'

/** Provider/MiniApp logo write intent: uploaded file, preset key, or bundled default. */
export const SetLogoIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), data: IconImageBytesSchema }),
  z.strictObject({ kind: z.literal('key'), key: LogoKeySchema }),
  z.strictObject({ kind: z.literal('default') })
])
export type SetLogoIntent = z.infer<typeof SetLogoIntentSchema>
