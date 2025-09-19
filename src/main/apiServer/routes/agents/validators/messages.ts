import { CreateSessionMessageRequestSchema } from '@types'

import { createZodValidator } from './zodValidator'

export const validateSessionMessage = createZodValidator({
  body: CreateSessionMessageRequestSchema
})
