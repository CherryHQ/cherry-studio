import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ResourceListGroupSeed,
  type ResourceListSection,
  SESSION_DISPLAY_LABEL_KEYS
} from '@renderer/components/chat/resourceList/base'
import type { ResourceListGroupResolver } from '@renderer/utils/chat/resourceListBase'
import {
  type AgentSessionDisplayMode,
  getSessionAgentGroupId,
  SESSION_PINNED_GROUP_ID,
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
  pinnedGroupIds: ReadonlySet<string>
  sessionGroupBy: ResourceListGroupResolver<SessionListItem>

  agentsForDisplay: readonly { id: string; name: string }[]
  displayMode: AgentSessionDisplayMode
  filteredGroupedSessions: readonly SessionListItem[]
  workdirDisplay: SessionWorkdirDisplayMaps
  workspaceRowsForDisplay: readonly AgentWorkspaceEntity[]
}

export function useSessionGroupStructure({
  pinnedGroupIds,
  sessionGroupBy,
  agentsForDisplay,
  displayMode,
  filteredGroupedSessions,
  workdirDisplay,
  workspaceRowsForDisplay
}: UseSessionGroupStructureOptions) {
  const { t } = useTranslation()
  const getSessionGroupSection = useCallback(
    (groupId: string): ResourceListSection => {
      if (groupId === SESSION_PINNED_GROUP_ID || pinnedGroupIds.has(groupId)) {
        return { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }
      if (groupId === SESSION_NO_PROJECT_GROUP_ID) {
        return { id: SESSION_NO_PROJECT_SECTION_ID, label: t('agent.session.group.tasks') }
      }
      return {
        id: displayMode === 'agent' ? SESSION_AGENT_SECTION_ID : SESSION_WORKDIR_SECTION_ID,
        label: t(SESSION_DISPLAY_LABEL_KEYS[displayMode])
      }
    },
    [displayMode, pinnedGroupIds, t]
  )
  const sessionSectionBy = useMemo(() => {
    if (displayMode === 'time') return undefined
    return (session: SessionListItem) => getSessionGroupSection(sessionGroupBy(session)?.id ?? '')
  }, [displayMode, getSessionGroupSection, sessionGroupBy])

  const sessionGroupSeeds = useMemo<ResourceListGroupSeed[]>(() => {
    const groupSeeds: ResourceListGroupSeed[] = []
    if (displayMode === 'agent') {
      for (const agent of agentsForDisplay) {
        const id = getSessionAgentGroupId(agent.id)
        groupSeeds.push({ id, label: agent.name, section: getSessionGroupSection(id) })
      }
    }
    if (displayMode === 'workdir') {
      for (const workspace of workspaceRowsForDisplay) {
        const id = workdirDisplay.groupIdByWorkspaceId.get(workspace.id)
        const label = id ? workdirDisplay.labelByGroupId.get(id) : undefined
        if (id && label) groupSeeds.push({ id, label, section: getSessionGroupSection(id) })
      }
    }
    if (displayMode === 'time') return groupSeeds
    const seededIds = new Set(groupSeeds.map((group) => group.id))
    for (const session of filteredGroupedSessions) {
      const group = sessionGroupBy(session)
      if (!group || seededIds.has(group.id)) continue
      groupSeeds.push({ ...group, section: getSessionGroupSection(group.id) })
      seededIds.add(group.id)
    }
    return groupSeeds.sort(
      (a, b) =>
        Number(b.section?.id === SESSION_PINNED_SECTION_ID) - Number(a.section?.id === SESSION_PINNED_SECTION_ID)
    )
  }, [
    agentsForDisplay,
    displayMode,
    filteredGroupedSessions,
    getSessionGroupSection,
    sessionGroupBy,
    workdirDisplay,
    workspaceRowsForDisplay
  ])

  return { sessionGroupSeeds, sessionSectionBy }
}
