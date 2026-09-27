import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgent, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentTurnFastMode } from '@renderer/hooks/agent/useAgentTurnFastMode'
import { useModelById } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

export function useAgentModelSettingsPanel(agentId: string | undefined, sessionId?: string) {
  const { t } = useTranslation()
  const { agent, isLoading: isAgentLoading } = useAgent(agentId ?? null)
  const { model, isLoading: isModelLoading } = useModelById(agent?.model)
  const { updateAgent } = useUpdateAgent()

  const canonicalReasoningEffort = agent?.configuration?.reasoning_effort ?? 'default'
  const [reasoningOverride, setReasoningOverride] = useState<{
    agentId: string
    value: ReasoningEffortOption
    version: number
  } | null>(null)
  const reasoningMutationVersionRef = useRef(0)
  const reasoningEffort =
    reasoningOverride !== null && reasoningOverride.agentId === agent?.id
      ? reasoningOverride.value
      : canonicalReasoningEffort

  const canonicalServiceTier = agent?.configuration?.service_tier ?? 'standard'
  const [serviceTierOverride, setServiceTierOverride] = useState<{
    agentId: string
    value: ServiceTierSelection
    version: number
  } | null>(null)
  const serviceTierMutationVersionRef = useRef(0)
  const serviceTier =
    serviceTierOverride !== null && serviceTierOverride.agentId === agent?.id
      ? serviceTierOverride.value
      : canonicalServiceTier

  const [fastMode, setFastMode] = useAgentTurnFastMode(sessionId)

  useEffect(() => {
    setReasoningOverride((current) => {
      if (!current) return current
      return current.agentId === agent?.id ? current : null
    })
  }, [agent?.id])

  useEffect(() => {
    setServiceTierOverride((current) => {
      if (!current) return current
      return current.agentId === agent?.id ? current : null
    })
  }, [agent?.id])

  useEffect(() => {
    if (model?.supportsFastMode !== true) setFastMode(false)
  }, [model?.supportsFastMode, setFastMode])

  const patchConfiguration = useCallback(
    async (configuration: { reasoning_effort?: ReasoningEffortOption; service_tier?: ServiceTierSelection }) => {
      if (!agent?.id) return
      const updated = await updateAgent({ id: agent.id, configuration }, { showSuccessToast: false })
      if (!updated) throw new Error('update failed')
    },
    [agent?.id, updateAgent]
  )

  const handleReasoningEffortChange = useCallback(
    (option: ReasoningEffortOption) => {
      if (!agent?.id) return
      const version = ++reasoningMutationVersionRef.current
      setReasoningOverride({ agentId: agent.id, value: option, version })
      void patchConfiguration({ reasoning_effort: option })
        .then(() => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
        })
        .catch((error) => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
          toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
        })
    },
    [agent?.id, patchConfiguration, t]
  )

  const handleServiceTierChange = useCallback(
    (tier: ServiceTierSelection) => {
      if (!agent?.id) return
      const version = ++serviceTierMutationVersionRef.current
      setServiceTierOverride({ agentId: agent.id, value: tier, version })
      void patchConfiguration({ service_tier: tier })
        .then(() => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
        })
        .catch((error) => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
          toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
        })
    },
    [agent?.id, patchConfiguration, t]
  )

  const pending = isAgentLoading || isModelLoading
  const ready = Boolean(agent?.id && model && !pending)

  return {
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
