import { CreateTaskRequestSchema, PaginationQuerySchema, TaskIdParamSchema, UpdateTaskRequestSchema } from '@types'

import { createZodValidator } from './zodValidator'

export const validateTask = createZodValidator({
  body: CreateTaskRequestSchema
})

export const validateTaskUpdate = createZodValidator({
  body: UpdateTaskRequestSchema
})

export const validateTaskId = createZodValidator({
  params: TaskIdParamSchema
})

export const validateTaskPagination = createZodValidator({
  query: PaginationQuerySchema
})
