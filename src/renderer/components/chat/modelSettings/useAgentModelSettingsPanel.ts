import { useCallback } from 'react'

import { useAgent, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentTurnFastMode } from '@renderer/hooks/agent/useAgentTurnFastMode'
import {
  useAgentPendingReasoningEffort,
  useAgentPendingServiceTier
} from '@renderer/hooks/chat/useAgentPendingModelSettings'
import { useModelById } from '@renderer/hooks/useModel'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

export function useAgentModelSettingsPanel(agentId: string | undefined, sessionId?: string) {
  const { agent, isLoading: isAgentLoading } = useAgent(agentId ?? null)
  const { model, isLoading: isModelLoading } = useModelById(agent?.model)
  const { updateAgent } = useUpdateAgent()

  const canonicalReasoningEffort = agent?.configuration?.reasoning_effort ?? 'default'
  const {
    effective: reasoningEffort,
    startPending: startReasoningPending,
    finishPending: finishReasoningPending
  } = useAgentPendingReasoningEffort(agent?.id ?? null, canonicalReasoningEffort)

  const canonicalServiceTier = agent?.configuration?.service_tier ?? 'standard'
  const {
    effective: serviceTier,
    startPending: startServiceTierPending,
    finishPending: finishServiceTierPending
  } = useAgentPendingServiceTier(agent?.id ?? null, canonicalServiceTier)

  const [fastMode, setFastMode] = useAgentTurnFastMode(sessionId)

  const handleReasoningEffortChange = useCallback(
    (option: ReasoningEffortOption) => {
      if (!agent?.id) return
      const version = startReasoningPending(option)
      void updateAgent({ id: agent.id, configuration: { reasoning_effort: option } }, { showSuccessToast: false })
        .then(() => finishReasoningPending(version))
        .catch(() => finishReasoningPending(version, true))
    },
    [agent?.id, finishReasoningPending, startReasoningPending, updateAgent]
  )

  const handleServiceTierChange = useCallback(
    (tier: ServiceTierSelection) => {
      if (!agent?.id) return
      const version = startServiceTierPending(tier)
      void updateAgent({ id: agent.id, configuration: { service_tier: tier } }, { showSuccessToast: false })
        .then(() => finishServiceTierPending(version))
        .catch(() => finishServiceTierPending(version, true))
    },
    [agent?.id, finishServiceTierPending, startServiceTierPending, updateAgent]
  )

  const pending = isAgentLoading || isModelLoading
  const ready = Boolean(agent?.id && model && !pending)

  return {
    agent,
    model,
    pending,
    ready,
    reasoningEffort,
    serviceTier,
    fastMode,
    handleReasoningEffortChange,
    handleServiceTierChange,
    onFastModeChange: setFastMode
  }
}
