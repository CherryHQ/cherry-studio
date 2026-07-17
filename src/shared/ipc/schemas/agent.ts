import { AgentEntitySchema } from '@shared/data/api/schemas/agents'
import * as z from 'zod'

import { defineRoute } from '../define'
import { EntityAvatarIntentSchema } from './entityImage'

export const agentRequestSchemas = {
  'agent.set_avatar': defineRoute({
    input: z.strictObject({ agentId: z.string().min(1), avatar: EntityAvatarIntentSchema }),
    output: AgentEntitySchema
  })
}
