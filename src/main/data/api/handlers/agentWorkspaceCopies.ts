import { agentWorkspaceCopyRecordService as records } from '@data/services/AgentWorkspaceCopyRecordService'
import type { AgentWorkspaceCopySchemas } from '@shared/data/api/schemas/agentWorkspaceCopies'
import type { HandlersFor } from '@shared/data/api/types'

export const agentWorkspaceCopyHandlers: HandlersFor<AgentWorkspaceCopySchemas> = {
  '/agent-workspace-copies': { GET: async () => records.list().map((row) => records.toEntity(row)) },
  '/agent-workspace-copies/:copyId': { GET: async ({ params }) => records.toEntity(records.get(params.copyId)) }
}
