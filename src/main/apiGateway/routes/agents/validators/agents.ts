import {
  AgentIdParamSchema,
  CreateAgentRequestSchema,
  ReplaceAgentRequestSchema,
  UpdateAgentRequestSchema
} from '@types'

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
