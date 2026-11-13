import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  remapResourceListCollapsedGroupIds,
  resolveDefaultCollapsedGroupIds
} from '@renderer/components/chat/resourceList/base'
import { useWindowScopedPersistCache } from '@renderer/hooks/useWindowScopedPersistCache'
import type { ResourceListGroupResolver } from '@renderer/utils/chat/resourceListBase'
import {
  type AgentSessionDisplayMode,
  getWorkdirPathFromSessionGroupId,
  type SessionListItem,
  type SessionWorkdirDisplayMaps
} from '@renderer/utils/chat/sessionListHelpers'

interface UseSessionExpansionOptions {
  agentIdFilter?: string | null
  displayMode: AgentSessionDisplayMode
  filteredGroupedSessions: readonly SessionListItem[]
  isRightPanel: boolean
  sessionGroupBy: ResourceListGroupResolver<SessionListItem>
  workdirDisplay: SessionWorkdirDisplayMaps
}

export function useSessionExpansion({
  agentIdFilter,
  displayMode,
  filteredGroupedSessions,
  isRightPanel,
  sessionGroupBy,
  workdirDisplay
}: UseSessionExpansionOptions) {
  const [sessionExpansionTime, setSessionExpansionTime] = useWindowScopedPersistCache(
    'ui.agent.session.expansion.time',
    'ui.window.agent.session.expansion.time'
  )
  const [sessionExpansionAgent, setSessionExpansionAgent] = useWindowScopedPersistCache(
    'ui.agent.session.expansion.agent',
    'ui.window.agent.session.expansion.agent'
  )
  const [sessionExpansionWorkdir, setSessionExpansionWorkdir] = useWindowScopedPersistCache(
    'ui.agent.session.expansion.workdir',
    'ui.window.agent.session.expansion.workdir'
  )
  const [rightPanelSessionExpansion, setRightPanelSessionExpansion] = useState<string[]>([])
  const sessionExpansion = isRightPanel
    ? rightPanelSessionExpansion
    : displayMode === 'agent' || displayMode === 'group'
      ? sessionExpansionAgent
      : displayMode === 'workdir'
        ? sessionExpansionWorkdir
        : sessionExpansionTime

  // Ref-guarded against <Activity> re-show: hide/show re-runs this effect with
  // an unchanged filter, and the fresh [] would wipe the user's expansion state
  // and force a re-render on every tab switch.
  const rightPanelExpansionFilterRef = useRef(agentIdFilter)
  useEffect(() => {
    if (rightPanelExpansionFilterRef.current === agentIdFilter) return
    rightPanelExpansionFilterRef.current = agentIdFilter
    if (isRightPanel) setRightPanelSessionExpansion([])
  }, [agentIdFilter, isRightPanel])

  const collapsedSessionState = useMemo(() => {
    const resolvedSessionExpansion = resolveDefaultCollapsedGroupIds({
      collapsedIds: sessionExpansion,
      groupBy: sessionGroupBy,
      items: filteredGroupedSessions
    })

    if (displayMode !== 'workdir') {
      return resolvedSessionExpansion
    }

    return remapResourceListCollapsedGroupIds(resolvedSessionExpansion, (groupId) => {
      const path = getWorkdirPathFromSessionGroupId(groupId)
      return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
    })
  }, [displayMode, filteredGroupedSessions, sessionExpansion, sessionGroupBy, workdirDisplay])

  const handleSessionCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (isRightPanel) {
        setRightPanelSessionExpansion(nextCollapsedIds)
        return
      }

      if (displayMode === 'agent' || displayMode === 'group') setSessionExpansionAgent(nextCollapsedIds)
      else if (displayMode === 'workdir') setSessionExpansionWorkdir(nextCollapsedIds)
      else setSessionExpansionTime(nextCollapsedIds)
    },
    [displayMode, isRightPanel, setSessionExpansionAgent, setSessionExpansionTime, setSessionExpansionWorkdir]
  )

  return { collapsedSessionState, handleSessionCollapsedStateChange }
}
