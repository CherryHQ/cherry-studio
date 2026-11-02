import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ResourceListGroupSeed,
  type ResourceListSection,
  SESSION_DISPLAY_LABEL_KEYS
} from '@renderer/components/chat/resourceList/base'
import {
  type AgentSessionDisplayMode,
  getSessionAgentGroupId,
  isSystemWorkspaceSession,
  SESSION_AGENT_SECTION_ID,
  SESSION_NO_PROJECT_GROUP_ID,
  SESSION_NO_PROJECT_SECTION_ID,
  SESSION_PINNED_SECTION_ID,
  SESSION_WORKDIR_SECTION_ID,
  type SessionListItem,
  type SessionWorkdirDisplayMaps
} from '@renderer/utils/chat/sessionListHelpers'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

interface UseSessionGroupStructureOptions {
  agentsForDisplay: readonly { id: string; name: string }[]
  displayMode: AgentSessionDisplayMode
  filteredGroupedSessions: readonly SessionListItem[]
  workdirDisplay: SessionWorkdirDisplayMaps
  workspaceRowsForDisplay: readonly AgentWorkspaceEntity[]
}

export function useSessionGroupStructure({
  agentsForDisplay,
  displayMode,
  filteredGroupedSessions,
  workdirDisplay,
  workspaceRowsForDisplay
}: UseSessionGroupStructureOptions) {
  const { t } = useTranslation()
  const sessionSectionBy = useMemo(() => {
    if (displayMode === 'time') return undefined

    return (session: SessionListItem): ResourceListSection => {
      if (session.pinned) {
        return { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }

      if (displayMode === 'workdir' && isSystemWorkspaceSession(session)) {
        return { id: SESSION_NO_PROJECT_SECTION_ID, label: t('agent.session.group.tasks') }
      }

      return {
        id: displayMode === 'agent' ? SESSION_AGENT_SECTION_ID : SESSION_WORKDIR_SECTION_ID,
        label: t(SESSION_DISPLAY_LABEL_KEYS[displayMode])
      }
    }
  }, [displayMode, t])

  const sessionGroupSeeds = useMemo<ResourceListGroupSeed[]>(() => {
    if (displayMode === 'agent') {
      const section = { id: SESSION_AGENT_SECTION_ID, label: t(SESSION_DISPLAY_LABEL_KEYS.agent) }
      return agentsForDisplay.map((agent) => ({ id: getSessionAgentGroupId(agent.id), label: agent.name, section }))
    }

    if (displayMode === 'workdir') {
      const section = { id: SESSION_WORKDIR_SECTION_ID, label: t(SESSION_DISPLAY_LABEL_KEYS.workdir) }
      const groupSeeds = workspaceRowsForDisplay.flatMap((workspace) => {
        const groupId = workdirDisplay.groupIdByWorkspaceId.get(workspace.id)
        const label = groupId ? workdirDisplay.labelByGroupId.get(groupId) : undefined
        return groupId && label ? [{ id: groupId, label, section }] : []
      })
      const hasNoProjectSessions = filteredGroupedSessions.some(
        (session) => !session.pinned && isSystemWorkspaceSession(session)
      )
      if (hasNoProjectSessions) {
        groupSeeds.push({
          id: SESSION_NO_PROJECT_GROUP_ID,
          label: '',
          section: { id: SESSION_NO_PROJECT_SECTION_ID, label: t('agent.session.group.tasks') }
        })
      }
      return groupSeeds
    }

    return []
  }, [agentsForDisplay, displayMode, filteredGroupedSessions, t, workdirDisplay, workspaceRowsForDisplay])

  return { sessionGroupSeeds, sessionSectionBy }
}
