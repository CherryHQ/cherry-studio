import * as z from 'zod'

export const WorkspaceCopyStateSchema = z.enum([
  'creating',
  'prepared',
  'ready',
  'failed',
  'cancelled',
  'deleting',
  'removed'
])
export const WorkspaceCopyCleanupSchema = z.enum(['none', 'pending', 'blocked'])
export const CreateWorkspaceCopySchema = z.strictObject({
  requestId: z.uuid(),
  sourceWorkspaceId: z.uuid(),
  name: z.string().trim().min(1).max(200).optional()
})
export type CreateWorkspaceCopyInput = z.infer<typeof CreateWorkspaceCopySchema>

export const WorkspaceCopyStatisticsSchema = z.strictObject({
  files: z.number(),
  directories: z.number(),
  links: z.number(),
  logicalBytes: z.number(),
  clonedFiles: z.number(),
  copiedFiles: z.number(),
  excludedEntries: z.number(),
  fallbackReasons: z.record(z.string(), z.number())
})
export type WorkspaceCopyStatistics = z.infer<typeof WorkspaceCopyStatisticsSchema>

export const WorkspaceCopyEntitySchema = z.strictObject({
  id: z.uuid(),
  requestId: z.uuid(),
  revision: z.number().int(),
  sourceWorkspaceId: z.string().nullable(),
  targetWorkspaceId: z.string().nullable(),
  intendedSessionId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  state: WorkspaceCopyStateSchema,
  cleanup: WorkspaceCopyCleanupSchema,
  cleanupReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  statistics: WorkspaceCopyStatisticsSchema.nullable(),
  storageFallback: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkspaceCopyEntity = z.infer<typeof WorkspaceCopyEntitySchema>

export type AgentWorkspaceCopySchemas = {
  '/agent-workspace-copies': { GET: { response: WorkspaceCopyEntity[] } }
  '/agent-workspace-copies/:copyId': { GET: { params: { copyId: string }; response: WorkspaceCopyEntity } }
}
