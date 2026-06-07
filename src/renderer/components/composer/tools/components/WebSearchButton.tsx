import { Tooltip } from '@cherrystudio/ui'
import { type IconRef, useIcon } from '@cherrystudio/ui/icons'
import { usePreference } from '@data/hooks/usePreference'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { WEB_SEARCH_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviderById } from '@renderer/hooks/useProvider'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'
import { getWebSearchProviderIconRef } from '@renderer/utils/webSearchProviderMeta'
import { isWebSearchProviderReady } from '@shared/data/presets/webSearchProviders'
import { resolveWebToolRoutes, type WebToolUnavailableReason } from '@shared/utils/provider'
import { useNavigate } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import type { FC, MouseEventHandler } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
}

// 'no-backend' is deliberately absent: the button stays enabled and clicking
// it opens the search-provider configuration flow instead.
const REASON_MESSAGE_KEYS: Partial<Record<WebToolUnavailableReason, string>> = {
  'model-unsupported': 'chat.input.web_search.builtin.disabled_content',
  'gemini-function-tool-conflict': 'chat.mcp.warning.gemini_web_search',
  'openai-minimal-reasoning': 'chat.web_search.warning.openai'
}

const WebSearchProviderIcon: FC<{ iconRef?: IconRef }> = ({ iconRef }) => {
  const Icon = useIcon(iconRef)
  return Icon ? <Icon width={18} height={18} /> : <Globe />
}

const useWebSearchToolController = ({ assistantId, launcher }: Props) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider: modelProvider } = useProviderById(model?.providerId)
  const {
    defaultFetchUrlsProvider,
    defaultSearchKeywordsProvider,
    isLoading: isLoadingWebSearchProviders
  } = useWebSearchProviders()
  const [clientToolsPreferred] = usePreference('chat.web_search.client_tools_preferred')

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false
  const clientSearchAvailable = isWebSearchProviderReady(defaultSearchKeywordsProvider, 'searchKeywords')
  const clientFetchAvailable = isWebSearchProviderReady(defaultFetchUrlsProvider, 'fetchUrls')
  // Same resolver as the main process; MCP mode stands in for the request's
  // eventual function tools, which only exist at build time.
  const { webSearch: webSearchRoute, reasons } =
    model && assistant
      ? resolveWebToolRoutes(model, modelProvider, {
          webSearchEnabled: true,
          // A ready external search provider wins over the provider-native route (mirrors the main
          // process: the preference only orders the sides when the client side is available).
          clientToolsPreferred: clientToolsPreferred || clientSearchAvailable,
          clientSearchAvailable,
          clientFetchAvailable,
          endpointType: model.endpointTypes?.[0] ?? modelProvider?.defaultChatEndpoint ?? undefined,
          hasFunctionToolSignals: getEffectiveMcpMode(assistant) !== 'disabled',
          reasoningEffort: assistant.settings.reasoning_effort
        })
      : { webSearch: 'none' as const, reasons: undefined }
  const searchUnavailableReason = webSearchRoute === 'none' ? (reasons?.webSearch ?? 'no-backend') : undefined
  const activeProviderId = clientSearchAvailable ? defaultSearchKeywordsProvider?.id : undefined

  const providerIconRef =
    enableWebSearch && webSearchRoute === 'client' && activeProviderId
      ? getWebSearchProviderIconRef(activeProviderId)
      : undefined
  const reasonMessageKey = searchUnavailableReason ? REASON_MESSAGE_KEYS[searchUnavailableReason] : undefined
  const disabledReason = !enableWebSearch && reasonMessageKey ? t(reasonMessageKey) : undefined
  const isDisabled = isLoadingWebSearchProviders || Boolean(disabledReason)

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

      if (searchUnavailableReason === 'no-backend') {
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
    [assistant, disabledReason, enableWebSearch, navigate, t, updateAssistant, model, searchUnavailableReason]
  )

  const ariaLabel = enableWebSearch ? t('common.close') : t('chat.input.web_search.label')
  // Which side will actually serve the request. Both sides look identical on the button, and the
  // preference that picks between them lives in settings — so name it here.
  const routeHint =
    webSearchRoute === 'server'
      ? t('chat.input.web_search.route.builtin')
      : webSearchRoute === 'client' && defaultSearchKeywordsProvider
        ? t('chat.input.web_search.route.client', { provider: defaultSearchKeywordsProvider.name })
        : undefined
  const tooltipTitle = disabledReason ?? routeHint ?? ariaLabel

  const icon = useMemo(() => <WebSearchProviderIcon iconRef={providerIconRef} />, [providerIconRef])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        ...WEB_SEARCH_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: t('chat.input.web_search.label'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.web_search.label', ['search']),
        icon,
        // The pinned toolbar and the quick panel render this launcher, not the button below, and
        // they fall back to `label` without it — so the serving side has to travel here too.
        tooltip: tooltipTitle,
        active: enableWebSearch,
        disabled: isDisabled,
        disabledReason,
        action: ({ inputAdapter }) => onClick(inputAdapter?.focus)
      }
    ])
  }, [disabledReason, enableWebSearch, icon, isDisabled, launcher, onClick, t, tooltipTitle])

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
