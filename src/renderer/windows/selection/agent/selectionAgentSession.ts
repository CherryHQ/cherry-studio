import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { isDataApiResourceNotFoundError } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { isAgentWorkspaceNotFoundError } from '@shared/ipc/errors/ai'
import type { AgentSelectionAction } from '@shared/types/selection'

export interface SelectionAgentTarget {
  /** Null runs on Cherry Assistant, recreating it when it was deleted. */
  agentId: string | null
  workspace: AgentSessionWorkspaceSource
}

export function getSelectionAgentTarget(action: AgentSelectionAction): SelectionAgentTarget {
  return {
    agentId: action.agentId ?? null,
    workspace: action.agentWorkspace ?? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
  }
}

/** Creates the window's one conversation session and returns its id. */
export async function createSelectionAgentSession({ agentId, workspace }: SelectionAgentTarget): Promise<string> {
  if (!agentId) {
    const { sessionId } = await ipcApi.request('ai.agent.assistant_session.create', { workspace })
    return sessionId
  }
  const session = await dataApiService.post('/agent-sessions', { body: { agentId, name: '', workspace } })
  return session.id
}

export function isSelectionWorkspaceUnavailableError(error: unknown): boolean {
  return isAgentWorkspaceNotFoundError(error) || isDataApiResourceNotFoundError(error, 'Workspace')
}
