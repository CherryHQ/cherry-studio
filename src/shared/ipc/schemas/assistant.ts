import { AssistantSchema } from '@shared/data/types/assistant'
import * as z from 'zod'

import { defineRoute } from '../define'
import { EntityAvatarIntentSchema } from './entityImage'

export const assistantRequestSchemas = {
  'assistant.set_avatar': defineRoute({
    input: z.strictObject({ assistantId: z.string().min(1), avatar: EntityAvatarIntentSchema }),
    output: AssistantSchema
  })
}
