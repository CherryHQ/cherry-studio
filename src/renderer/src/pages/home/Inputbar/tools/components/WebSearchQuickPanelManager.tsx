import {
  isGemini3Model,
  isGeminiModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  isWebSearchModel
} from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isGeminiWebSearchProvider } from '@renderer/utils/provider'
import { useNavigate } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const WebSearchProviderIcon = ({ size = 18, color }: { size?: number; color?: string }) => {
  return <Globe className="icon" size={size} style={{ color, fontSize: size }} />
}

export const useWebSearchPanelController = (assistantId: string) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { defaultSearchKeywordsProvider: defaultWebSearchProvider, defaultFetchUrlsProvider } = useWebSearchProviders()
  const enableWebSearch = !!assistant.enableWebSearch

  const openWebSearchSettings = useCallback(() => {
    window.modal.confirm({
      title: t('settings.tool.websearch.search_provider'),
      content: t('settings.tool.websearch.search_provider_placeholder'),
      okText: t('settings.tool.websearch.api_key_required.ok'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: () => {
        void navigate({ to: '/settings/websearch' })
      }
    })
  }, [navigate, t])

  const canEnableExternalWebSearch = useCallback(() => {
    for (const provider of [defaultWebSearchProvider, defaultFetchUrlsProvider]) {
      if (!provider) {
        openWebSearchSettings()
        return false
      }
    }

    return true
  }, [defaultFetchUrlsProvider, defaultWebSearchProvider, openWebSearchSettings])

  const updateToModelBuiltinWebSearch = useCallback(() => {
    const model = assistant.model as Model | undefined
    if (!model) {
      window.toast.error(t('error.model.not_exists'))
      return
    }

    const nextEnableWebSearch = !assistant.enableWebSearch
    if (nextEnableWebSearch && !isWebSearchModel(model) && !canEnableExternalWebSearch()) {
      return
    }

    const update = {
      ...assistant,
      enableWebSearch: nextEnableWebSearch
    }
    const provider = getProviderByModel(model)

    // Older Gemini models cannot combine built-in web search with function tool use while MCP is active.
    if (
      provider &&
      isGeminiWebSearchProvider(provider) &&
      isGeminiModel(model) &&
      !isGemini3Model(model) &&
      isToolUseModeFunction(assistant) &&
      update.enableWebSearch &&
      getEffectiveMcpMode(assistant) !== 'disabled'
    ) {
      update.enableWebSearch = false
      window.toast.warning(t('chat.mcp.warning.gemini_web_search'))
    }

    if (
      isOpenAIWebSearchModel(model) &&
      isGPT5SeriesReasoningModel(model) &&
      update.enableWebSearch &&
      assistant.settings?.reasoning_effort === 'minimal'
    ) {
      update.enableWebSearch = false
      window.toast.warning(t('chat.web_search.warning.openai'))
    }

    updateAssistant(update)
  }, [assistant, canEnableExternalWebSearch, t, updateAssistant])

  return {
    enableWebSearch,
    toggleQuickPanel: updateToModelBuiltinWebSearch,
    updateToModelBuiltinWebSearch
  }
}

export default function WebSearchQuickPanelManager() {
  // Inputbar tools require a quickPanelManager export even when this tool has no panel UI.
  return null
}
