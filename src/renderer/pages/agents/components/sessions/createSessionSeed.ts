import { type SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

export type CreateSessionSeed = {
  agentId?: string | null
  workspace?: AgentSessionWorkspaceSource
  workspacePath?: string
}

export function buildCreateSessionSeed(
  session: Pick<AgentSessionEntity, 'agentId' | 'workspaceId' | 'workspace'> | null | undefined
): CreateSessionSeed | null {
  if (!session?.agentId) return null

  if (session.workspace?.type === 'system') {
    return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
  }

  if (session.workspaceId) {
    return {
      agentId: session.agentId,
      workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    }
  }

  if (session.workspace?.path) {
    return { agentId: session.agentId, workspacePath: session.workspace.path }
  }

  return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
}

export function buildCreateSessionSeedIndex(
  sessions: readonly SessionListItem[],
  getGroupId: (session: SessionListItem) => string | null | undefined
) {
  let latestSession: { session: SessionListItem; lastActivityAtMs: number } | null = null
  const latestSessionByGroupId = new Map<string, { session: SessionListItem; lastActivityAtMs: number }>()

  for (const session of sessions) {
    if (session.pinned) continue

    const parsedLastActivityAtMs = Date.parse(session.lastActivityAt)
    const lastActivityAtMs = Number.isFinite(parsedLastActivityAtMs) ? parsedLastActivityAtMs : Number.NEGATIVE_INFINITY
    if (!latestSession || lastActivityAtMs > latestSession.lastActivityAtMs) {
      latestSession = { session, lastActivityAtMs }
    }

    const groupId = getGroupId(session)
    if (!groupId) continue

    const latestGroupSession = latestSessionByGroupId.get(groupId)
    if (!latestGroupSession || lastActivityAtMs > latestGroupSession.lastActivityAtMs) {
      latestSessionByGroupId.set(groupId, { session, lastActivityAtMs })
    }
  }

  const byGroupId = new Map<string, CreateSessionSeed | null>()
  for (const [groupId, candidate] of latestSessionByGroupId) {
    byGroupId.set(groupId, buildCreateSessionSeed(candidate.session))
  }

  return {
    latest: buildCreateSessionSeed(latestSession?.session),
    byGroupId
  }
}

export function createSessionSeedPreservesFileWorkspace(
  seed: CreateSessionSeed,
  activeSession: SessionListItem
): boolean {
  if (seed.workspace?.type === AGENT_WORKSPACE_TYPE.USER) {
    return activeSession.workspaceId === seed.workspace.workspaceId
  }
  // A path-only seed may be promoted to a persisted workspace id, and each
  // system session owns a distinct generated-files directory. Only an exact
  // existing user workspace id proves that the file session survives.
  return false
}
