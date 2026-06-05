import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const AgentWorkspaceNameSchema = z.string().min(1)
export const AgentWorkspacePathSchema = z.string().min(1)
export const AgentWorkspaceTypeSchema = z.enum(['user', 'system'])
export type AgentWorkspaceType = z.infer<typeof AgentWorkspaceTypeSchema>

export const AgentWorkspaceEntitySchema = z.strictObject({
  id: z.string(),
  name: AgentWorkspaceNameSchema,
  path: AgentWorkspacePathSchema,
  type: AgentWorkspaceTypeSchema,
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentWorkspaceEntity = z.infer<typeof AgentWorkspaceEntitySchema>

export type AgentWorkspaceSchemas = {
  '/agent-workspaces': {
    GET: {
      response: AgentWorkspaceEntity[]
    }
  }

  '/agent-workspaces/:workspaceId': {
    GET: {
      params: { workspaceId: string }
      response: AgentWorkspaceEntity
    }
    DELETE: {
      params: { workspaceId: string }
      response: void
    }
  }
} & OrderEndpoints<'/agent-workspaces'>
