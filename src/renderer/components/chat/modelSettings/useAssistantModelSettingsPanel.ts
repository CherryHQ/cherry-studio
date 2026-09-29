import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import {
  useAssistantPendingReasoningEffort,
  useAssistantPendingServiceTier,
  useAssistantPendingSettingsPatch
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

  const {
    effectiveSettings,
    startPending: startSettingsPatchPending,
    finishPending: finishSettingsPatchPending
  } = useAssistantPendingSettingsPatch(selectedAssistantId, assistant?.settings)

  const [fastMode, setFastMode] = useChatTurnFastMode(topicId)

  const persistSettings = useCallback(
    (patch: Partial<AssistantSettings>) => {
      if (!selectedAssistantId) return Promise.resolve(undefined)
      return updateAssistantSettings(patch)?.catch((error) => {
        logger.warn('Failed to persist assistant model settings', { error })
        toast.error(t('common.save_failed'))
      })
    },
    [selectedAssistantId, t, updateAssistantSettings]
  )

  const patchSettings = useCallback(
    (patch: Partial<AssistantSettings>) => {
      const version = startSettingsPatchPending(patch)
      return persistSettings(patch)
        ?.then(() => finishSettingsPatchPending(version))
        .catch(() => finishSettingsPatchPending(version, true))
    },
    [finishSettingsPatchPending, persistSettings, startSettingsPatchPending]
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
      void persistSettings({ reasoning_effort: option })
        ?.then(() => finishReasoningPending(version))
        .catch(() => finishReasoningPending(version, true))
    },
    [
      assistant?.settings.enableWebSearch,
      finishReasoningPending,
      model,
      persistSettings,
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
      void persistSettings({ service_tier: tier })
        ?.then(() => finishServiceTierPending(version))
        .catch(() => finishServiceTierPending(version, true))
    },
    [finishServiceTierPending, persistSettings, selectedAssistantId, startServiceTierPending]
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
    reasoningSummary: effectiveSettings?.reasoning_summary,
    serviceTier,
    fastMode,
    settings: effectiveSettings,
    patchSettings,
    handleReasoningEffortChange,
    handleReasoningSummaryChange,
    handleServiceTierChange,
    onFastModeChange: setFastMode
  }
}
