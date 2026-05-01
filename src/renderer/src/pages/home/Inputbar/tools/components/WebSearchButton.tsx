import { ActionIconButton } from '@renderer/components/Buttons'
import {
  isGemini3Model,
  isGeminiModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel
} from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { getWebSearchProviderLogo } from '@renderer/config/webSearchProviders'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { webSearchService } from '@renderer/services/WebSearchService'
import { getEffectiveMcpMode } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isGeminiWebSearchProvider } from '@renderer/utils/provider'
import { Tooltip } from 'antd'
import { Globe } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
}

const WebSearchButton: FC<Props> = ({ assistantId }) => {
  const { t } = useTranslation()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()
  const { provider: defaultProvider } = useDefaultWebSearchProvider()
  const { providers } = useWebSearchProviders()
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false

  const activeProviderId = useMemo(() => {
    if (defaultProvider && webSearchService.isWebSearchEnabled(defaultProvider.id)) {
      return defaultProvider.id
    }
    return providers.find((p) => webSearchService.isWebSearchEnabled(p.id))?.id
  }, [defaultProvider, providers])

  const providerLogo = activeProviderId ? getWebSearchProviderLogo(activeProviderId) : undefined

  const onClick = useCallback(() => {
    if (!assistant || !v1Model) {
      window.toast.error(t('error.model.not_exists'))
      return
    }
    if (enableWebSearch) {
      void updateAssistant({ settings: { enableWebSearch: false } })
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
  }, [assistant, enableWebSearch, setTimeoutTimer, t, updateAssistant, v1Model])

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
