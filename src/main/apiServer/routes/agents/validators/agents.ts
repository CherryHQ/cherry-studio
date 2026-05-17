import {
  AgentIdParamSchema,
  AgentStyleModeSchema,
  CreateAgentRequestSchema,
  ReplaceAgentRequestSchema,
  UpdateAgentRequestSchema
} from '@types'
import * as z from 'zod'

import { createZodValidator } from './zodValidator'

export const validateAgent = createZodValidator({
  body: CreateAgentRequestSchema
})

export const validateAgentReplace = createZodValidator({
  body: ReplaceAgentRequestSchema
})

export const validateAgentUpdate = createZodValidator({
  body: UpdateAgentRequestSchema
})

export const validateAgentId = createZodValidator({
  params: AgentIdParamSchema
})

export const validateAgentStyleMode = createZodValidator({
  params: AgentIdParamSchema,
  body: z.object({
    style_mode: AgentStyleModeSchema
  })
})
