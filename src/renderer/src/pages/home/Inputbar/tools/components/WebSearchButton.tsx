import { ActionIconButton } from '@renderer/components/Buttons'
import {
  isGemini3Model,
  isGeminiModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  isWebSearchModel
} from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { getWebSearchProviderLogo } from '@renderer/pages/settings/WebSearchSettings/utils/webSearchProviderMeta'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getEffectiveMcpMode } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isGeminiWebSearchProvider } from '@renderer/utils/provider'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import { checkWebSearchAvailability } from '@shared/data/utils/webSearchPreferences'
import { useNavigate } from '@tanstack/react-router'
import { Tooltip } from 'antd'
import { Globe } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
}

// Mirrors WebSearchProviderSetting.tsx: api-type providers (except fetch /
// searxng / exa-mcp) authenticate via API key. searxng uses basic auth and
// fetch / exa-mcp need neither.
const webSearchProviderRequiresApiKey = (id: WebSearchProviderId): boolean =>
  id !== 'fetch' && id !== 'searxng' && id !== 'exa-mcp'

const WebSearchButton: FC<Props> = ({ assistantId }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()
  const { defaultSearchKeywordsProvider } = useWebSearchProviders()
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false
  const hasBuiltinWebSearch = v1Model ? isWebSearchModel(v1Model) : false

  const activeProviderId = useMemo(() => {
    if (
      defaultSearchKeywordsProvider &&
      checkWebSearchAvailability(defaultSearchKeywordsProvider, webSearchProviderRequiresApiKey)
    ) {
      return defaultSearchKeywordsProvider.id
    }
    return undefined
  }, [defaultSearchKeywordsProvider])

  // When the model has built-in web search, the toggle just flips the
  // assistant flag — no external provider is invoked, so don't show its logo.
  const providerLogo = !hasBuiltinWebSearch && activeProviderId ? getWebSearchProviderLogo(activeProviderId) : undefined

  const onClick = useCallback(() => {
    if (!assistant || !v1Model) {
      window.toast.error(t('error.model.not_exists'))
      return
    }
    if (enableWebSearch) {
      void updateAssistant({ settings: { enableWebSearch: false } })
      return
    }

    // Built-in web search bypasses the external-provider requirement; the
    // toggle simply flips the assistant flag and the model handles search.
    if (!hasBuiltinWebSearch && !activeProviderId) {
      window.modal.confirm({
        centered: true,
        title: t('settings.tool.websearch.search_provider'),
        content: t('settings.tool.websearch.search_provider_placeholder'),
        onOk: () => navigate({ to: '/settings/websearch' })
      })
      return
    }

    // Compatibility guards before enabling. Mirrors the previous
    // `updateToModelBuiltinWebSearch` checks; toast feedback stays in the
    // renderer for immediacy.
    const provider = getProviderByModel(v1Model)
    if (
      provider &&
      isGeminiWebSearchProvider(provider) &&
      isGeminiModel(v1Model) &&
      !isGemini3Model(v1Model) &&
      isToolUseModeFunction(assistant) &&
      getEffectiveMcpMode(assistant) !== 'disabled'
    ) {
      window.toast.warning(t('chat.mcp.warning.gemini_web_search'))
      return
    }
    if (
      isOpenAIWebSearchModel(v1Model) &&
      isGPT5SeriesReasoningModel(v1Model) &&
      assistant.settings.reasoning_effort === 'minimal'
    ) {
      window.toast.warning(t('chat.web_search.warning.openai'))
      return
    }

    setTimeoutTimer('enableWebSearch', () => updateAssistant({ settings: { enableWebSearch: true } }), 0)
  }, [
    activeProviderId,
    assistant,
    enableWebSearch,
    hasBuiltinWebSearch,
    navigate,
    setTimeoutTimer,
    t,
    updateAssistant,
    v1Model
  ])

  const ariaLabel = enableWebSearch ? t('common.close') : t('chat.input.web_search.label')

  const ProviderMono = enableWebSearch ? providerLogo?.Mono : undefined
  const icon = ProviderMono ? <ProviderMono width={18} height={18} /> : <Globe />

  return (
    <Tooltip placement="top" title={ariaLabel} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={onClick}
        active={enableWebSearch}
        aria-label={ariaLabel}
        aria-pressed={enableWebSearch}
        icon={icon}
      />
    </Tooltip>
  )
}

export default memo(WebSearchButton)
