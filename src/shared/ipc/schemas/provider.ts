import * as z from 'zod'

import { defineRoute } from '../define'
import { LogoImageIntentSchema } from './entityImage'

/**
 * Provider imperative IPC commands. `provider.set_logo` sends business intent +
 * raw bytes (a logo edit can't go through DataApi, which carries no bytes); the
 * main handler delegates to `setProviderLogo`, which creates the `file_entry`,
 * binds it via the provider's `file_ref` slot, and compensates on failure.
 */
export const providerRequestSchemas = {
  'provider.set_logo': defineRoute({
    input: z.strictObject({ providerId: z.string().min(1), image: LogoImageIntentSchema }),
    output: z.void()
  })
}
