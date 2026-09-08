import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useBuiltinAgentListVisibility')

type BuiltinAgentVisibilityCandidate = {
  id: string
  configuration?: { builtin_role?: unknown } | null
}

export function useBuiltinAgentListVisibility() {
  const { t } = useTranslation()
  const [hiddenBuiltinAgentIds = []] = usePreference('agent.session.hidden_builtin_ids')
  const isLoading = preferenceService.getCachedValue('agent.session.hidden_builtin_ids') === undefined
  const hiddenBuiltinAgentIdSet = useMemo(() => new Set(hiddenBuiltinAgentIds), [hiddenBuiltinAgentIds])
  const hasHiddenBuiltinAgents = hiddenBuiltinAgentIds.length > 0
  const isBuiltinAgentHidden = useCallback(
    (agent: BuiltinAgentVisibilityCandidate) =>
      hiddenBuiltinAgentIdSet.has(agent.id) && isProtectedBuiltinAgentRole(agent.configuration?.builtin_role),
    [hiddenBuiltinAgentIdSet]
  )
  const filterHiddenBuiltinAgents = useCallback(
    <T extends BuiltinAgentVisibilityCandidate>(agents: readonly T[]) => agents.filter(isBuiltinAgentHidden),
    [isBuiltinAgentHidden]
  )
  const filterVisibleAgents = useCallback(
    <T extends BuiltinAgentVisibilityCandidate>(agents: readonly T[]) =>
      isLoading ? [] : agents.filter((agent) => !isBuiltinAgentHidden(agent)),
    [isBuiltinAgentHidden, isLoading]
  )

  const setBuiltinAgentVisible = useCallback(
    async (agentId: string, visible: boolean) => {
      try {
        await preferenceService.update('agent.session.hidden_builtin_ids', (currentIds) =>
          visible
            ? currentIds.filter((hiddenAgentId) => hiddenAgentId !== agentId)
            : [...new Set([...currentIds, agentId])]
        )
        return true
      } catch (error) {
        logger.error('Failed to update built-in Agent list visibility', { agentId, error, visible })
        toast.error(t('common.error'))
        return false
      }
    },
    [t]
  )

  const hideBuiltinAgent = useCallback(
    (agentId: string) => setBuiltinAgentVisible(agentId, false),
    [setBuiltinAgentVisible]
  )
  const showBuiltinAgent = useCallback(
    (agentId: string) => setBuiltinAgentVisible(agentId, true),
    [setBuiltinAgentVisible]
  )

  return {
    filterHiddenBuiltinAgents,
    filterVisibleAgents,
    hasHiddenBuiltinAgents,
    hiddenBuiltinAgentIds,
    hideBuiltinAgent,
    isLoading,
    showBuiltinAgent
  }
}
