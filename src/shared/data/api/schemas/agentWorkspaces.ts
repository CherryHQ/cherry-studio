import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const AgentWorkspaceNameSchema = z.string().min(1)
export const AgentWorkspacePathSchema = z.string().min(1)
export const AGENT_WORKSPACE_TYPES = ['user', 'system'] as const
export const AgentWorkspaceTypeSchema = z.enum(AGENT_WORKSPACE_TYPES)
export type AgentWorkspaceType = (typeof AGENT_WORKSPACE_TYPES)[number]

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
