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

// `name` is optional — the service derives it from the path basename when omitted.
export const CreateWorkspaceSchema = WorkspaceEntitySchema.pick({ path: true, name: true }).partial({ name: true })
export type CreateWorkspaceDto = z.infer<typeof CreateWorkspaceSchema>

export const UpdateWorkspaceSchema = WorkspaceEntitySchema.pick({ name: true })
export type UpdateWorkspaceDto = z.infer<typeof UpdateWorkspaceSchema>

export type WorkspaceSchemas = {
  '/workspaces': {
    GET: {
      response: WorkspaceEntity[]
    }
    // find-or-create by path: idempotent on the `agent_workspace.path` unique index.
    POST: {
      body: CreateWorkspaceDto
      response: WorkspaceEntity
    }
  }

  '/workspaces/:workspaceId': {
    GET: {
      params: { workspaceId: string }
      response: WorkspaceEntity
    }
    PATCH: {
      params: { workspaceId: string }
      body: UpdateWorkspaceDto
      response: WorkspaceEntity
    }
    DELETE: {
      params: { workspaceId: string }
      response: void
    }
  }
} & OrderEndpoints<'/workspaces'>
