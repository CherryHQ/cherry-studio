import { AssistantSchema } from '@shared/data/types/assistant'
import * as z from 'zod'

import { defineRoute } from '../define'
import { SetAvatarIntentSchema } from './avatar'

export const assistantRequestSchemas = {
  'assistant.set_avatar': defineRoute({
    input: z.strictObject({ assistantId: z.string().min(1), avatar: SetAvatarIntentSchema }),
    output: AssistantSchema
  })
}
