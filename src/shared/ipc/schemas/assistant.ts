import * as z from 'zod'

import { AssistantIdSchema } from '@shared/data/types/assistant'

import { defineRoute } from '../define'
import { ImageBytesSchema } from './entityImage'

export const assistantRequestSchemas = {
  'assistant.toggle_default_mcp': defineRoute({
    input: z.strictObject({ serverId: z.string().min(1), enabled: z.boolean() }),
    output: z.array(z.string())
  }),
  'assistant.set_avatar': defineRoute({
    input: z.strictObject({
      assistantId: AssistantIdSchema,
      avatar: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
        z.strictObject({ kind: z.literal('emoji'), emoji: z.emoji() }),
        z.strictObject({ kind: z.literal('default') })
      ])
    }),
    output: z.void()
  })
}
