import * as z from 'zod'

import { defineRoute } from '../define'

export const toolResultRequestSchemas = {
  'tool_result.preview_image': defineRoute({
    input: z.strictObject({ url: z.url().max(8192), imageHint: z.boolean() }),
    output: z.string().nullable()
  })
}
