import * as z from 'zod'

import { TimestampSchema } from '../essential'
import { NodeIdSchema } from '../node'

export const refCommonFields = {
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file node ID (UUID v7 or system node ID) */
  nodeId: NodeIdSchema,
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
}

type BusinessRefShape = {
  sourceType: z.ZodLiteral
  sourceId: z.ZodUUID | z.ZodString
  role: z.ZodEnum
}

export const createRefSchema = <T extends BusinessRefShape>(shape: T): z.ZodObject<typeof refCommonFields & T> =>
  z.object({
    ...refCommonFields,
    ...shape
  })
