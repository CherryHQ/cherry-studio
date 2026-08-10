import * as z from 'zod'

import { defineRoute } from '../define'

export const externalAppRequestSchemas = {
  'external_app.open': defineRoute({
    input: z.strictObject({ appId: z.literal('wt'), targetPath: z.string().min(1) }),
    output: z.void()
  })
}
