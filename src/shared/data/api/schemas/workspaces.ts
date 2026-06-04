import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const WorkspaceNameSchema = z.string().min(1)
export const WorkspacePathSchema = z.string().min(1)

export const WorkspaceEntitySchema = z.strictObject({
  id: z.string(),
  name: WorkspaceNameSchema,
  path: WorkspacePathSchema,
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
  }
} & OrderEndpoints<'/workspaces'>
