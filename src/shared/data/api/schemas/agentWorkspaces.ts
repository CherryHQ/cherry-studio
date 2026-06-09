import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const AgentWorkspaceNameSchema = z.string().min(1)
export const AgentWorkspacePathSchema = z.string().min(1)
export const AGENT_WORKSPACE_TYPES = ['user', 'system'] as const
export type AgentWorkspaceType = (typeof AGENT_WORKSPACE_TYPES)[number]
export const AGENT_WORKSPACE_TYPE = {
  USER: 'user',
  SYSTEM: 'system'
} as const satisfies Record<string, AgentWorkspaceType>
export const AgentWorkspaceTypeSchema = z.enum(AGENT_WORKSPACE_TYPES)

export const AgentSessionWorkspaceSourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user'),
    workspaceId: z.string().min(1)
  }),
  z.strictObject({
    type: z.literal('system')
  })
])
export type AgentSessionWorkspaceSource = z.infer<typeof AgentSessionWorkspaceSourceSchema>

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
  }
} & OrderEndpoints<'/agent-workspaces'>
