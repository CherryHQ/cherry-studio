import { BaiduOutlined, GoogleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { BingLogo, BochaLogo, ExaLogo, SearXNGLogo, TavilyLogo, ZhipuLogo } from '@renderer/components/Icons'
import { QuickPanelListItem, QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import {
  isGeminiModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  isWebSearchModel
} from '@renderer/config/models'
import { isGeminiWebSearchProvider } from '@renderer/config/providers'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { getProviderByModel } from '@renderer/services/AssistantService'
import WebSearchService from '@renderer/services/WebSearchService'
import { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { Tooltip } from 'antd'
import { Globe } from 'lucide-react'
import { FC, memo, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface WebSearchButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<WebSearchButtonRef | null>
  assistantId: string
}

const logger = loggerService.withContext('WebSearchButton')

const WebSearchButton: FC<Props> = ({ ref, assistantId }) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { providers } = useWebSearchProviders()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()

  // 注意：assistant.enableWebSearch 有不同的语义
  /** 表示是否启用网络搜索 */
  const enableWebSearch = assistant?.webSearchProviderId || assistant.enableWebSearch

  const WebSearchIcon = useCallback(
    ({ pid, size = 18, color }: { pid?: WebSearchProviderId; size?: number; color?: string }) => {
      switch (pid) {
        case 'bocha':
          return <BochaLogo className="icon" width={size} height={size} color={color} />
        case 'exa':
          // size微调，视觉上和其他图标平衡一些
          return <ExaLogo className="icon" width={size - 2} height={size} color={color} />
        case 'tavily':
          return <TavilyLogo className="icon" width={size} height={size} color={color} />
        case 'zhipu':
          return <ZhipuLogo className="icon" width={size} height={size} color={color} />
        case 'searxng':
          return <SearXNGLogo className="icon" width={size} height={size} color={color} />
        case 'local-baidu':
          return <BaiduOutlined size={size} style={{ color, fontSize: size }} />
        case 'local-bing':
          return <BingLogo className="icon" width={size} height={size} color={color} />
        case 'local-google':
          return <GoogleOutlined size={size} style={{ color, fontSize: size }} />
        default:
          return <Globe className="icon" size={size} style={{ color, fontSize: size }} />
      }
    },
    []
  )

  const updateWebSearchProvider = useCallback(
    async (providerId?: WebSearchProvider['id']) => {
      setTimeoutTimer('updateWebSearchProvider', () => {
        updateAssistant({
          ...assistant,
          webSearchProviderId: providerId,
          enableWebSearch: false
        })
      })
    },
    [assistant, setTimeoutTimer, updateAssistant]
  )

  const updateQuickPanelItem = useCallback(
    async (providerId?: WebSearchProvider['id']) => {
      if (providerId === assistant.webSearchProviderId) {
        updateWebSearchProvider(undefined)
      } else {
        updateWebSearchProvider(providerId)
      }
    },
    [assistant.webSearchProviderId, updateWebSearchProvider]
  )

  const updateToModelBuiltinWebSearch = useCallback(async () => {
    const update = {
      ...assistant,
      webSearchProviderId: undefined,
      enableWebSearch: !assistant.enableWebSearch
    }
    const model = assistant.model
    const provider = getProviderByModel(model)
    if (!model) {
      logger.error('Model does not exist.')
      window.toast.error(t('error.model.not_exists'))
      return
    }
    if (
      isGeminiWebSearchProvider(provider) &&
      isGeminiModel(model) &&
      isToolUseModeFunction(assistant) &&
      update.enableWebSearch &&
      assistant.mcpServers &&
      assistant.mcpServers.length > 0
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
    setTimeoutTimer('updateSelectedWebSearchBuiltin', () => updateAssistant(update), 200)
  }, [assistant, setTimeoutTimer, t, updateAssistant])

  const providerItems = useMemo<QuickPanelListItem[]>(() => {
    const isWebSearchModelEnabled = assistant.model && isWebSearchModel(assistant.model)

    const items: QuickPanelListItem[] = providers
      .map((p) => ({
        label: p.name,
        description: WebSearchService.isWebSearchEnabled(p.id)
          ? hasObjectKey(p, 'apiKey')
            ? t('settings.tool.websearch.apikey')
            : t('settings.tool.websearch.free')
          : t('chat.input.web_search.enable_content'),
        icon: <WebSearchIcon size={13} pid={p.id} />,
        isSelected: p.id === assistant?.webSearchProviderId,
        disabled: !WebSearchService.isWebSearchEnabled(p.id),
        action: () => updateQuickPanelItem(p.id)
      }))
      .filter((o) => !o.disabled)

    if (isWebSearchModelEnabled) {
      items.unshift({
        label: t('chat.input.web_search.builtin.label'),
        description: isWebSearchModelEnabled
          ? t('chat.input.web_search.builtin.enabled_content')
          : t('chat.input.web_search.builtin.disabled_content'),
        icon: <Globe />,
        isSelected: assistant.enableWebSearch,
        disabled: !isWebSearchModelEnabled,
        action: () => updateToModelBuiltinWebSearch()
      })
    }

    return items
  }, [
    WebSearchIcon,
    assistant.enableWebSearch,
    assistant.model,
    assistant?.webSearchProviderId,
    providers,
    t,
    updateQuickPanelItem,
    updateToModelBuiltinWebSearch
  ])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('chat.input.web_search.label'),
      list: providerItems,
      symbol: QuickPanelReservedSymbol.WebSearch,
      pageSize: 9
    })
  }, [quickPanel, t, providerItems])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.WebSearch) {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  const onClick = useCallback(() => {
    if (enableWebSearch) {
      updateWebSearchProvider(undefined)
    } else {
      handleOpenQuickPanel()
    }
  }, [enableWebSearch, handleOpenQuickPanel, updateWebSearchProvider])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      title={enableWebSearch ? t('common.close') : t('chat.input.web_search.label')}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={onClick} active={!!enableWebSearch}>
        <WebSearchIcon pid={assistant.webSearchProviderId} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(WebSearchButton)
