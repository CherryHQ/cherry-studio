import * as z from 'zod'

import { defineRoute } from '../define'

export const conversationIslandRequestSchemas = {
  'conversation_island.set_expanded': defineRoute({
    input: z.object({ expanded: z.boolean() }),
    output: z.void()
  })
}
