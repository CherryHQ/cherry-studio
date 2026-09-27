import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import {
  useAssistantPendingReasoningEffort,
  useAssistantPendingServiceTier
} from '@renderer/hooks/chat/useAssistantPendingModelSettings'
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
  const {
    effective: reasoningEffort,
    startPending: startReasoningPending,
    finishPending: finishReasoningPending
  } = useAssistantPendingReasoningEffort(selectedAssistantId, canonicalReasoningEffort)

  const canonicalServiceTier = assistant?.settings.service_tier ?? 'standard'
  const {
    effective: serviceTier,
    startPending: startServiceTierPending,
    finishPending: finishServiceTierPending
  } = useAssistantPendingServiceTier(selectedAssistantId, canonicalServiceTier)

  const [fastMode, setFastMode] = useChatTurnFastMode(topicId)

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
      const version = startReasoningPending(option)
      void patchSettings({ reasoning_effort: option })
        ?.then(() => finishReasoningPending(version))
        .catch(() => finishReasoningPending(version))
    },
    [
      assistant?.settings.enableWebSearch,
      finishReasoningPending,
      model,
      patchSettings,
      selectedAssistantId,
      startReasoningPending,
      t
    ]
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
      const version = startServiceTierPending(tier)
      void patchSettings({ service_tier: tier })
        ?.then(() => finishServiceTierPending(version))
        .catch(() => finishServiceTierPending(version))
    },
    [finishServiceTierPending, patchSettings, selectedAssistantId, startServiceTierPending]
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
