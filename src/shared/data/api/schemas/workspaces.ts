import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const WorkspaceNameSchema = z.string().min(1)
export const WorkspacePathSchema = z.string().min(1)
export const WorkspaceTypeSchema = z.enum(['user', 'system'])
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>

export const WorkspaceEntitySchema = z.strictObject({
  id: z.string(),
  name: WorkspaceNameSchema,
  path: WorkspacePathSchema,
  type: WorkspaceTypeSchema,
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkspaceEntity = z.infer<typeof WorkspaceEntitySchema>

export type WorkspaceSchemas = {
  '/workspaces': {
    GET: {
      response: WorkspaceEntity[]
    }
  }

  '/workspaces/:workspaceId': {
    GET: {
      params: { workspaceId: string }
      response: WorkspaceEntity
    }
    DELETE: {
      params: { workspaceId: string }
      response: void
    }
  }
} & OrderEndpoints<'/workspaces'>
