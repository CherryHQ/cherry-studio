import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import { t } from '@main/i18n'
import { getPathStatus, type PathStatus } from '@main/utils/file'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

const logger = loggerService.withContext('AgentSessionWorkspace')

export class AgentSessionWorkspaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSessionWorkspaceError'
  }
}

export function isAgentSessionWorkspaceError(error: unknown): error is AgentSessionWorkspaceError {
  return error instanceof AgentSessionWorkspaceError
}

export async function prepareAgentSessionWorkspaceDirectory(session: AgentSessionEntity): Promise<void> {
  const workspace = session.workspace
  switch (workspace.type) {
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      // System workspaces are app-owned session directories; user workspaces
      // must already exist, so auto-creating them would mask a bad user path.
      await ensureSystemWorkspaceDirectory(workspace.path)
      break
    case AGENT_WORKSPACE_TYPE.USER:
      break
    default: {
      const exhaustive: never = workspace.type
      throw new AgentSessionWorkspaceError(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
  await assertAgentSessionWorkspaceDirectory(session.id, workspace.path)
}

async function ensureSystemWorkspaceDirectory(cwd: string): Promise<void> {
  const root = path.resolve(application.getPath('feature.agents.system_workspaces'))
  const target = path.resolve(cwd)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AgentSessionWorkspaceError(`System workspace path is outside the managed workspace root: ${cwd}`)
  }
  try {
    await ensureAgentStorageDirectory(root, target)
  } catch (error) {
    logger.warn(`Failed to validate or create system workspace directory: ${cwd}`, { error })
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, { ok: false, reason: 'inaccessible' }))
  }
}

export async function assertAgentSessionWorkspaceDirectory(sessionId: string, cwd: string): Promise<void> {
  const status = await getPathStatus(cwd)
  if (status.ok && status.kind === 'directory') return
  logger.warn(`Agent session ${sessionId} workspace invalid: ${cwd}`)
  throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
}

function workspacePathErrorMessage(workspacePath: string, status: PathStatus): string {
  if (status.ok) {
    return t('agent.session.workspace_status.not_directory', { path: workspacePath })
  }
  return status.reason === 'missing'
    ? t('agent.session.workspace_status.missing', { path: workspacePath })
    : t('agent.session.workspace_status.inaccessible', { path: workspacePath })
}
