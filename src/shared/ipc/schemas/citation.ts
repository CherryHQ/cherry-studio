import * as z from 'zod'

import { defineRoute } from '../define'

export const citationRequestSchemas = {
  'citation.fetch_preview': defineRoute({
    input: z.object({ url: z.url() }),
    output: z.object({ content: z.string() })
  })
}
