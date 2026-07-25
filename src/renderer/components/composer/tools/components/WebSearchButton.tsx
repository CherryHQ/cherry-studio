import { Tooltip } from '@cherrystudio/ui'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'
import { canModelUseAssistantWebSearch, hasModelBuiltinWebSearch } from '@renderer/utils/model'
import { getWebSearchProviderLogo } from '@renderer/utils/webSearchProviderMeta'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import { isGemini3Model, isGeminiModel, isGPT5SeriesReasoningModel, isOpenAIWebSearchModel } from '@shared/utils/model'
import { isGeminiWebSearchProvider } from '@shared/utils/provider'
import { useNavigate } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import type { FC, MouseEventHandler } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
}

const KEYLESS_PROVIDERS: ReadonlySet<WebSearchProviderId> = new Set(['fetch', 'searxng', 'exa-mcp', 'firecrawl'])
const webSearchProviderRequiresApiKey = (id: WebSearchProviderId): boolean => !KEYLESS_PROVIDERS.has(id)

const useWebSearchToolController = ({ assistantId, launcher }: Props) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider: modelProvider } = useProvider(model?.providerId ?? '')
  const { defaultSearchKeywordsProvider } = useWebSearchProviders()

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false
  const hasBuiltinWebSearch = model ? hasModelBuiltinWebSearch(model) : false
  const canUseWebSearch = assistant && model ? canModelUseAssistantWebSearch(model) : false

  const activeProviderId = useMemo(() => {
    const p = defaultSearchKeywordsProvider
    if (!p) return undefined
    const available = webSearchProviderRequiresApiKey(p.id)
      ? p.apiKeys.some((k) => k.trim().length > 0)
      : Boolean(p.capabilities.find((c) => c.feature === 'searchKeywords')?.apiHost?.trim())
    return available ? p.id : undefined
  }, [defaultSearchKeywordsProvider])
  const hasSearchBackend = hasBuiltinWebSearch || Boolean(activeProviderId)

  // When the model has built-in web search, the toggle just flips the
  // assistant flag — no external provider is invoked, so don't show its logo.
  const providerLogo = !hasBuiltinWebSearch && activeProviderId ? getWebSearchProviderLogo(activeProviderId) : undefined
  const hasGeminiWebSearchConflict = Boolean(
    modelProvider &&
      assistant &&
      model &&
      isGeminiWebSearchProvider(modelProvider) &&
      isGeminiModel(model) &&
      !isGemini3Model(model) &&
      getEffectiveMcpMode(assistant) !== 'disabled'
  )
  const hasOpenAIMinimalWebSearchConflict = Boolean(
    model &&
      assistant &&
      isOpenAIWebSearchModel(model) &&
      isGPT5SeriesReasoningModel(model) &&
      assistant.settings.reasoning_effort === 'minimal'
  )
  const disabledReason =
    !enableWebSearch && hasSearchBackend
      ? !canUseWebSearch
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

      // Built-in web search bypasses the external-provider requirement; the
      // toggle simply flips the assistant flag and the model handles search.
      if (!hasBuiltinWebSearch && !activeProviderId) {
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
    [
      activeProviderId,
      assistant,
      disabledReason,
      enableWebSearch,
      hasBuiltinWebSearch,
      navigate,
      t,
      updateAssistant,
      model
    ]
  )

  const ariaLabel = enableWebSearch ? t('common.close') : t('chat.input.web_search.label')
  const tooltipTitle = disabledReason ?? ariaLabel

  const ProviderIcon = enableWebSearch ? providerLogo : undefined
  const icon = useMemo(() => (ProviderIcon ? <ProviderIcon width={18} height={18} /> : <Globe />), [ProviderIcon])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'web-search',
        kind: 'command',
        sources: ['popover'],
        order: 30,
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
