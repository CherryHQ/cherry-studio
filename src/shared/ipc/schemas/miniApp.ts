import * as z from 'zod'

import { defineRoute } from '../define'
import { LogoImageIntentSchema } from './entityImage'

/**
 * Mini-app imperative IPC commands. `mini_app.set_logo` mirrors
 * `provider.set_logo`: raw bytes + intent in, the main handler delegates to
 * `EntityLogoService` (create `file_entry` → bind the slot → compensate).
 */
export const miniAppRequestSchemas = {
  'mini_app.set_logo': defineRoute({
    input: z.strictObject({ appId: z.string().min(1), image: LogoImageIntentSchema }),
    output: z.void()
  })
}
