import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { WEB_SEARCH_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'
import { isOpenAIWebSearchModel } from '@renderer/utils/model'
import { getWebSearchProviderLogo } from '@renderer/utils/webSearchProviderMeta'
import { isWebSearchProviderReady } from '@shared/data/presets/webSearchProviders'
import { isGPT5SeriesReasoningModel, isWebToolConflictProneGeminiModel } from '@shared/utils/model'
import { isBuiltinWebSearchAvailable, isGeminiWebSearchProvider, resolveWebToolRoutes } from '@shared/utils/provider'
import { useNavigate } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import type { FC, MouseEventHandler } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
}

const useWebSearchToolController = ({ assistantId, launcher }: Props) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider: modelProvider } = useProvider(model?.providerId ?? '')
  const { defaultFetchUrlsProvider, defaultSearchKeywordsProvider } = useWebSearchProviders()
  const [clientToolsPreferred] = usePreference('chat.web_search.client_tools_preferred')

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false
  const clientSearchAvailable = isWebSearchProviderReady(defaultSearchKeywordsProvider, 'searchKeywords')
  const clientFetchAvailable = isWebSearchProviderReady(defaultFetchUrlsProvider, 'fetchUrls')
  const webSearchRoute = model
    ? resolveWebToolRoutes(model, modelProvider, {
        webSearchEnabled: true,
        clientSearchAvailable,
        clientFetchAvailable,
        clientToolsPreferred
      }).webSearch
    : 'none'
  const hasSearchBackend =
    clientSearchAvailable || (model && modelProvider ? isBuiltinWebSearchAvailable(model, modelProvider) : false)
  const usesServerSearch = webSearchRoute === 'server'
  const activeProviderId = clientSearchAvailable ? defaultSearchKeywordsProvider?.id : undefined

  const providerLogo =
    webSearchRoute === 'client' && activeProviderId ? getWebSearchProviderLogo(activeProviderId) : undefined
  const hasGeminiWebSearchConflict = Boolean(
    usesServerSearch &&
      modelProvider &&
      assistant &&
      model &&
      isGeminiWebSearchProvider(modelProvider) &&
      isWebToolConflictProneGeminiModel(model) &&
      getEffectiveMcpMode(assistant) !== 'disabled'
  )
  const hasOpenAIMinimalWebSearchConflict = Boolean(
    usesServerSearch &&
      model &&
      assistant &&
      isOpenAIWebSearchModel(model) &&
      isGPT5SeriesReasoningModel(model) &&
      assistant.settings.reasoning_effort === 'minimal'
  )
  const disabledReason =
    !enableWebSearch && hasSearchBackend
      ? webSearchRoute === 'none'
        ? t('chat.input.web_search.builtin.disabled_content')
        : hasGeminiWebSearchConflict
          ? t('chat.mcp.warning.gemini_web_search')
          : hasOpenAIMinimalWebSearchConflict
            ? t('chat.web_search.warning.openai')
            : undefined
      : undefined
  const isDisabled = Boolean(disabledReason)

  const onClick = useCallback(
    async (restoreFocus?: () => void) => {
      if (!assistant || !model) {
        toast.error(t('error.model.not_exists'))
        return
      }
      if (enableWebSearch) {
        void updateAssistant({ settings: { enableWebSearch: false } })
        return
      }

      if (webSearchRoute === 'none') {
        let navigatedAway = false

        const confirmed = await popup.confirm({
          centered: true,
          title: t('settings.tool.websearch.search_provider'),
          content: t('settings.tool.websearch.search_provider_placeholder'),
          // Return focus to the trigger (button or composer input) once the dialog
          // closes, unless the user navigated to settings. focusOnClose overrides
          // Radix's default focus-return, so there is no race and no rAF needed.
          focusOnClose: restoreFocus
            ? () => {
                if (!navigatedAway) {
                  restoreFocus()
                }
              }
            : undefined
        })
        if (!confirmed) return

        navigatedAway = true
        await navigate({ to: '/settings/websearch' })
        return
      }

      if (disabledReason) {
        return
      }

      void updateAssistant({ settings: { enableWebSearch: true } })
    },
    [assistant, disabledReason, enableWebSearch, navigate, t, updateAssistant, model, webSearchRoute]
  )

  const ariaLabel = enableWebSearch ? t('common.close') : t('chat.input.web_search.label')
  const tooltipTitle = disabledReason ?? ariaLabel

  const ProviderIcon = enableWebSearch ? providerLogo : undefined
  const icon = useMemo(() => (ProviderIcon ? <ProviderIcon width={18} height={18} /> : <Globe />), [ProviderIcon])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        ...WEB_SEARCH_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: t('chat.input.web_search.label'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.web_search.label', ['search']),
        icon,
        active: enableWebSearch,
        disabled: isDisabled,
        disabledReason,
        action: ({ inputAdapter }) => onClick(inputAdapter?.focus)
      }
    ])
  }, [disabledReason, enableWebSearch, icon, isDisabled, launcher, onClick, t])

  return { ariaLabel, enableWebSearch, icon, isDisabled, onClick, tooltipTitle }
}

export const WebSearchToolRuntime: FC<Props> = (props) => {
  useWebSearchToolController(props)
  return null
}

const WebSearchButton: FC<Props> = (props) => {
  const { ariaLabel, enableWebSearch, icon, isDisabled, onClick, tooltipTitle } = useWebSearchToolController(props)
  const handleClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      const trigger = event.currentTarget
      void onClick(() => trigger.focus())
    },
    [onClick]
  )

  return (
    <Tooltip placement="top" content={tooltipTitle}>
      <ActionIconButton
        onClick={handleClick}
        active={enableWebSearch}
        aria-label={ariaLabel}
        aria-pressed={enableWebSearch}
        disabled={isDisabled}
        icon={icon}
      />
    </Tooltip>
  )
}

export default memo(WebSearchButton)
