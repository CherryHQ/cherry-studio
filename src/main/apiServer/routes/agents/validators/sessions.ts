import { CreateSessionRequestSchema, SessionIdParamSchema, UpdateSessionRequestSchema } from '@types'

import { createZodValidator } from './zodValidator'

export const validateSession = createZodValidator({
  body: CreateSessionRequestSchema
})

export const validateSessionUpdate = createZodValidator({
  body: UpdateSessionRequestSchema
})

export const validateSessionId = createZodValidator({
  params: SessionIdParamSchema
})
