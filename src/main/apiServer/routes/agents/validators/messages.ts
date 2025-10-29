import { CreateSessionMessageRequestSchema, SessionMessageIdParamSchema } from '@types'

import { createZodValidator } from './zodValidator'

export const validateSessionMessage = createZodValidator({
  body: CreateSessionMessageRequestSchema
})

export const validateSessionMessageId = createZodValidator({
  params: SessionMessageIdParamSchema
})
