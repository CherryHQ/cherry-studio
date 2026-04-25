import { BaiduOutlined, GoogleOutlined } from '@ant-design/icons'
import { Querit } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { BingLogo, BochaLogo, ExaLogo, SearXNGLogo, TavilyLogo, ZhipuLogo } from '@renderer/components/Icons'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
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
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import type { ToolQuickPanelController, ToolRenderContext } from '@renderer/pages/home/Inputbar/types'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { webSearchService } from '@renderer/services/WebSearchService'
import { getEffectiveMcpMode, type WebSearchProviderId } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isGeminiWebSearchProvider } from '@renderer/utils/provider'
import { Globe } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebSearchQuickPanel')

export const WebSearchProviderIcon = ({
  pid,
  size = 18,
  color
}: {
  pid?: WebSearchProviderId
  size?: number
  color?: string
}) => {
  switch (pid) {
    case 'bocha':
      return <BochaLogo className="icon" width={size} height={size} color={color} />
    case 'exa':
      return <ExaLogo className="icon" width={size - 2} height={size} color={color} />
    case 'tavily':
      return <TavilyLogo className="icon" width={size} height={size} color={color} />
    case 'zhipu':
      return <ZhipuLogo className="icon" width={size} height={size} color={color} />
    case 'searxng':
      return <SearXNGLogo className="icon" width={size} height={size} color={color} />
    case 'querit':
      return <Querit.Mono className="icon" width={size} height={size} color={color} />
    case 'local-baidu':
      return <BaiduOutlined size={size} style={{ color, fontSize: size }} />
    case 'local-bing':
      return <BingLogo className="icon" width={size} height={size} color={color} />
    case 'local-google':
      return <GoogleOutlined size={size} style={{ color, fontSize: size }} />
    default:
      return <Globe className="icon" size={size} style={{ color, fontSize: size }} />
  }
}

export const useWebSearchPanelController = (assistantId: string, quickPanelController: ToolQuickPanelController) => {
  const { t } = useTranslation()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])
  const { providers } = useWebSearchProviders()
  const { setTimeoutTimer } = useTimer()

  const enableWebSearch = assistant?.settings.enableWebSearch ?? false

  const setEnableWebSearch = useCallback(
    (next: boolean) => {
      if (!assistant) return
      setTimeoutTimer('setEnableWebSearch', () => {
        void updateAssistant({
          settings: { ...assistant.settings, enableWebSearch: next }
        })
      })
    },
    [assistant, setTimeoutTimer, updateAssistant]
  )

  const updateToModelBuiltinWebSearch = useCallback(async () => {
    if (!assistant || !v1Model) {
      logger.error('Model does not exist.')
      window.toast.error(t('error.model.not_exists'))
      return
    }
    let nextEnableWebSearch = !assistant.settings.enableWebSearch
    const provider = getProviderByModel(v1Model)
    // Gemini 3+ supports combining built-in tools with function calling
    if (
      provider &&
      isGeminiWebSearchProvider(provider) &&
      isGeminiModel(v1Model) &&
      !isGemini3Model(v1Model) &&
      isToolUseModeFunction(assistant) &&
      nextEnableWebSearch &&
      getEffectiveMcpMode(assistant) !== 'disabled'
    ) {
      nextEnableWebSearch = false
      window.toast.warning(t('chat.mcp.warning.gemini_web_search'))
    }
    if (
      isOpenAIWebSearchModel(v1Model) &&
      isGPT5SeriesReasoningModel(v1Model) &&
      nextEnableWebSearch &&
      assistant.settings.reasoning_effort === 'minimal'
    ) {
      nextEnableWebSearch = false
      window.toast.warning(t('chat.web_search.warning.openai'))
    }
    setTimeoutTimer(
      'updateSelectedWebSearchBuiltin',
      () => updateAssistant({ settings: { ...assistant.settings, enableWebSearch: nextEnableWebSearch } }),
      200
    )
  }, [assistant, v1Model, setTimeoutTimer, t, updateAssistant])

  const providerItems = useMemo<QuickPanelListItem[]>(() => {
    const isWebSearchModelEnabled = !!v1Model && isWebSearchModel(v1Model)
    const items: QuickPanelListItem[] = []
    items.push(
      ...providers
        .map((p) => ({
          label: p.name,
          description: webSearchService.isWebSearchEnabled(p.id)
            ? hasObjectKey(p, 'apiKey')
              ? t('settings.tool.websearch.apikey')
              : t('settings.tool.websearch.free')
            : t('chat.input.web_search.enable_content'),
          icon: <WebSearchProviderIcon size={13} pid={p.id} />,
          isSelected: false,
          disabled: !webSearchService.isWebSearchEnabled(p.id),
          action: () => setEnableWebSearch(true)
        }))
        .filter((item) => !item.disabled)
    )

    if (isWebSearchModelEnabled) {
      items.unshift({
        label: t('chat.input.web_search.builtin.label'),
        description: isWebSearchModelEnabled
          ? t('chat.input.web_search.builtin.enabled_content')
          : t('chat.input.web_search.builtin.disabled_content'),
        icon: <Globe />,
        isSelected: enableWebSearch,
        disabled: !isWebSearchModelEnabled,
        action: () => updateToModelBuiltinWebSearch()
      })
    }

    return items
  }, [v1Model, enableWebSearch, providers, t, setEnableWebSearch, updateToModelBuiltinWebSearch])

  const openQuickPanel = useCallback(() => {
    quickPanelController.open({
      title: t('chat.input.web_search.label'),
      list: providerItems,
      symbol: QuickPanelReservedSymbol.WebSearch,
      pageSize: 9
    })
  }, [providerItems, quickPanelController, t])

  const toggleQuickPanel = useCallback(() => {
    if (quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.WebSearch) {
      quickPanelController.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanelController])

  return {
    enableWebSearch,
    providerItems,
    openQuickPanel,
    toggleQuickPanel,
    setEnableWebSearch,
    updateToModelBuiltinWebSearch
  }
}

interface ManagerProps {
  context: ToolRenderContext<any, any>
}

const WebSearchQuickPanelManager = ({ context }: ManagerProps) => {
  const { assistant, quickPanel, quickPanelController, t } = context
  const { providerItems, openQuickPanel } = useWebSearchPanelController(assistant.id, quickPanelController)
  const { registerRootMenu, registerTrigger } = quickPanel
  const { updateList, isVisible, symbol } = quickPanelController

  useEffect(() => {
    if (isVisible && symbol === QuickPanelReservedSymbol.WebSearch) {
      updateList(providerItems)
    }
  }, [isVisible, providerItems, symbol, updateList])

  useEffect(() => {
    const disposeMenu = registerRootMenu([
      {
        label: t('chat.input.web_search.label'),
        description: '',
        icon: <Globe size={18} />,
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.WebSearch, () => openQuickPanel())

    return () => {
      disposeMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, registerRootMenu, registerTrigger, t])

  return null
}

export default WebSearchQuickPanelManager
