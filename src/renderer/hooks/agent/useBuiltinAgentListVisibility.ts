import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useBuiltinAgentListVisibility')

export function useBuiltinAgentListVisibility() {
  const { t } = useTranslation()
  const [hiddenBuiltinAgentIds, setHiddenBuiltinAgentIds] = usePreference('agent.session.hidden_builtin_ids')

  const setBuiltinAgentVisible = useCallback(
    async (agentId: string, visible: boolean) => {
      const nextIds = visible
        ? hiddenBuiltinAgentIds.filter((hiddenAgentId) => hiddenAgentId !== agentId)
        : [...new Set([...hiddenBuiltinAgentIds, agentId])]
      if (nextIds.length === hiddenBuiltinAgentIds.length) return true

      try {
        await setHiddenBuiltinAgentIds(nextIds)
        return true
      } catch (error) {
        logger.error('Failed to update built-in Agent list visibility', { agentId, error, visible })
        toast.error(t('common.error'))
        return false
      }
    },
    [hiddenBuiltinAgentIds, setHiddenBuiltinAgentIds, t]
  )

  const hideBuiltinAgent = useCallback(
    (agentId: string) => setBuiltinAgentVisible(agentId, false),
    [setBuiltinAgentVisible]
  )
  const showBuiltinAgent = useCallback(
    (agentId: string) => setBuiltinAgentVisible(agentId, true),
    [setBuiltinAgentVisible]
  )

  return { hiddenBuiltinAgentIds, hideBuiltinAgent, showBuiltinAgent }
}
