import * as z from 'zod'

import { createRefSchema } from './essential'

export const exampleSourceType = 'example' as const

export const exampleRoles = ['role'] as const

export const exampleFileRefSchema = createRefSchema({
  sourceType: z.literal(exampleSourceType),
  sourceId: z.uuidv4(),
  role: z.enum(exampleRoles)
})
