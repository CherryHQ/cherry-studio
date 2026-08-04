import * as z from 'zod'

import { defineRoute } from '../define'

export const citationRequestSchemas = {
  'citation.fetch_preview': defineRoute({
    input: z.strictObject({ url: z.url(), requestId: z.string().min(1) }),
    output: z.object({ content: z.string() })
  }),
  'citation.cancel_previews': defineRoute({
    input: z.strictObject({ requestId: z.string().min(1) }),
    output: z.void()
  })
}
