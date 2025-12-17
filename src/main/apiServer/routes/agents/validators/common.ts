import { PaginationQuerySchema } from '@types'

import { createZodValidator } from './zodValidator'

export const validatePagination = createZodValidator({
  query: PaginationQuerySchema
})
