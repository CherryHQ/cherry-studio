import {
  CreateSessionRequestSchema,
  ReplaceSessionRequestSchema,
  SessionIdParamSchema,
  UpdateSessionRequestSchema
} from '@types'

import { createZodValidator } from './zodValidator'

export const validateSession = createZodValidator({
  body: CreateSessionRequestSchema
})

export const validateSessionReplace = createZodValidator({
  body: ReplaceSessionRequestSchema
})

export const validateSessionUpdate = createZodValidator({
  body: UpdateSessionRequestSchema
})

export const validateSessionId = createZodValidator({
  params: SessionIdParamSchema
})
