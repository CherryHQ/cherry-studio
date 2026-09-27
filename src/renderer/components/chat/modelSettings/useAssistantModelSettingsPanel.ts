import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useChatTurnFastMode } from '@renderer/hooks/chat/useChatTurnFastMode'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { toast } from '@renderer/services/toast'
import type { AssistantSettings } from '@renderer/types/assistant'
import { isGPT5SeriesReasoningModel, isOpenAIWebSearchModel } from '@renderer/utils/model'
import type { ReasoningSummary, ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

const logger = loggerService.withContext('useAssistantModelSettingsPanel')

export function useAssistantModelSettingsPanel(assistantId: string | undefined, topicId?: string) {
  const { t } = useTranslation()
  const { assistant, model, isLoading, isModelPending, updateAssistantSettings } = useAssistant(assistantId, {
    loadDefaultModel: true
  })

  const selectedAssistantId = assistant?.id ?? null
  const canonicalReasoningEffort = assistant?.settings.reasoning_effort ?? 'default'
  const [reasoningOverride, setReasoningOverride] = useState<{
    assistantId: string
    value: ReasoningEffortOption
    version: number
  } | null>(null)
  const reasoningMutationVersionRef = useRef(0)
  const reasoningEffort =
    reasoningOverride?.assistantId === selectedAssistantId ? reasoningOverride.value : canonicalReasoningEffort

  const canonicalServiceTier = assistant?.settings.service_tier ?? 'standard'
  const [serviceTierOverride, setServiceTierOverride] = useState<{
    assistantId: string
    value: ServiceTierSelection
    version: number
  } | null>(null)
  const serviceTierMutationVersionRef = useRef(0)
  const serviceTier =
    serviceTierOverride?.assistantId === selectedAssistantId ? serviceTierOverride.value : canonicalServiceTier

  const [fastMode, setFastMode] = useChatTurnFastMode(topicId)

  useEffect(() => {
    setReasoningOverride((current) => {
      if (!current) return current
      return current.assistantId === selectedAssistantId ? current : null
    })
  }, [selectedAssistantId])

  useEffect(() => {
    setServiceTierOverride((current) => {
      if (!current) return current
      return current.assistantId === selectedAssistantId ? current : null
    })
  }, [selectedAssistantId])

  const patchSettings = useCallback(
    (patch: Partial<AssistantSettings>) => {
      if (!selectedAssistantId) return Promise.resolve(undefined)
      return updateAssistantSettings(patch)?.catch((error) => {
        logger.warn('Failed to persist assistant model settings', { error })
        toast.error(t('common.save_failed'))
      })
    },
    [selectedAssistantId, t, updateAssistantSettings]
  )

  const handleReasoningEffortChange = useCallback(
    (option: ReasoningEffortOption) => {
      if (!selectedAssistantId || !model) return
      if (
        option === 'minimal' &&
        isOpenAIWebSearchModel(model) &&
        isGPT5SeriesReasoningModel(model) &&
        assistant?.settings.enableWebSearch
      ) {
        toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      const version = ++reasoningMutationVersionRef.current
      setReasoningOverride({ assistantId: selectedAssistantId, value: option, version })
      void patchSettings({ reasoning_effort: option })
        ?.then(() => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
        })
        .catch(() => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
        })
    },
    [assistant?.settings.enableWebSearch, model, patchSettings, selectedAssistantId, t]
  )

  const handleReasoningSummaryChange = useCallback(
    (summary: ReasoningSummary) => {
      void patchSettings({ reasoning_summary: summary })
    },
    [patchSettings]
  )

  const handleServiceTierChange = useCallback(
    (tier: ServiceTierSelection) => {
      if (!selectedAssistantId) return
      const version = ++serviceTierMutationVersionRef.current
      setServiceTierOverride({ assistantId: selectedAssistantId, value: tier, version })
      void patchSettings({ service_tier: tier })
        ?.then(() => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
        })
        .catch(() => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
        })
    },
    [patchSettings, selectedAssistantId]
  )

  const speedControlModel = model && selectedAssistantId ? model : undefined
  const pending = isLoading || isModelPending
  const ready = Boolean(selectedAssistantId && speedControlModel && !pending)

  return {
    assistant,
    model: speedControlModel,
    pending,
    ready,
    reasoningEffort,
    reasoningSummary: assistant?.settings.reasoning_summary,
    serviceTier,
    fastMode,
    settings: assistant?.settings,
    patchSettings,
    handleReasoningEffortChange,
    handleReasoningSummaryChange,
    handleServiceTierChange,
    onFastModeChange: setFastMode
  }
}
