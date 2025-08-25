import { BaiduOutlined, GoogleOutlined } from '@ant-design/icons'
import { BingLogo, BochaLogo, ExaLogo, SearXNGLogo, TavilyLogo } from '@renderer/components/Icons'
import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { Assistant, WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Tooltip } from 'antd'
import { Globe } from 'lucide-react'
import { FC, memo, startTransition, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface WebSearchButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<WebSearchButtonRef | null>
  assistant: Assistant
  ToolbarButton: any
}

const WebSearchButton: FC<Props> = ({ ref, assistant, ToolbarButton }) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { providers } = useWebSearchProviders()
  const { updateAssistant } = useAssistant(assistant.id)

  // 注意：assistant.enableWebSearch 有不同的语义
  /** 表示是否启用网络搜索 */
  const enableWebSearch = assistant?.webSearchProviderId || assistant.enableWebSearch

  const WebSearchIcon = useCallback(
    ({ pid, size = 18, color }: { pid?: WebSearchProviderId; size?: number; color?: string }) => {
      switch (pid) {
        case 'bocha':
          return <BochaLogo width={size} height={size} color={color} />
        case 'exa':
          // size微调，视觉上和其他图标平衡一些
          return <ExaLogo width={size - 2} height={size} color={color} />
        case 'tavily':
          return <TavilyLogo width={size} height={size} color={color} />
        case 'searxng':
          return <SearXNGLogo width={size} height={size} color={color} />
        case 'local-baidu':
          return <BaiduOutlined size={size} style={{ color, fontSize: size }} />
        case 'local-bing':
          return <BingLogo width={size} height={size} color={color} />
        case 'local-google':
          return <GoogleOutlined size={size} style={{ color, fontSize: size }} />
        default:
          return <Globe size={size} style={{ color, fontSize: size }} />
      }
    },
    [enableWebSearch]
  )

  const updateWebSearchProvider = useCallback(
    async (providerId?: WebSearchProvider['id']) => {
      // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
      startTransition(() => {
        updateAssistant({
          ...assistant,
          webSearchProviderId: providerId,
          enableWebSearch: false
        })
      })
    },
    [assistant, updateAssistant]
  )

  const updateQuickPanelItem = useCallback(
    async (providerId?: WebSearchProvider['id']) => {
      // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
      if (providerId === assistant.webSearchProviderId) {
        updateWebSearchProvider(undefined)
      } else {
        updateWebSearchProvider(providerId)
      }
    },
    [assistant.webSearchProviderId, updateWebSearchProvider]
  )

  const updateToModelBuiltinWebSearch = useCallback(async () => {
    // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
    startTransition(() => {
      updateAssistant({ ...assistant, webSearchProviderId: undefined, enableWebSearch: !assistant.enableWebSearch })
    })
  }, [assistant, updateAssistant])

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
      symbol: '?',
      pageSize: 9
    })
  }, [quickPanel, t, providerItems])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '?') {
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

  const color = enableWebSearch ? 'var(--color-primary)' : 'var(--color-icon)'

  return (
    <Tooltip
      placement="top"
      title={enableWebSearch ? t('common.close') : t('chat.input.web_search.label')}
      mouseLeaveDelay={0}
      arrow>
      <ToolbarButton type="text" onClick={onClick}>
        <WebSearchIcon color={color} pid={assistant.webSearchProviderId} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(WebSearchButton)
