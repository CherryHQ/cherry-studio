import * as z from 'zod'

import { defineRoute } from '../define'

// ── Request: renderer→main DevTools capability calls (zod values, always parsed) ──
export const devtoolsRequestSchemas = {
  'devtools.toggle': defineRoute({ input: z.void(), output: z.void() })
}
