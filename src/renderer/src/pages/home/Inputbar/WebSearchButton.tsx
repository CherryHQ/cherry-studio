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

  const enableWebSearch = assistant?.webSearchProviderId || assistant.enableWebSearch

  const WebSearchIcon = useCallback(
    ({ pid, size = 18 }: { pid?: WebSearchProviderId; size?: number }) => {
      const iconColor = enableWebSearch ? 'var(--color-primary)' : 'var(--color-icon)'

      switch (pid) {
        case 'bocha':
          return <BochaLogo width={size} height={size} color={iconColor} />
        case 'exa':
          // size微调，视觉上和其他图标平衡一些
          return <ExaLogo width={size - 2} height={size} color={iconColor} />
        case 'tavily':
          return <TavilyLogo width={size} height={size} color={iconColor} />
        case 'searxng':
          return <SearXNGLogo width={size} height={size} color={iconColor} />
        case 'local-baidu':
          return <BaiduOutlined size={size} style={{ color: iconColor, fontSize: size }} />
        case 'local-bing':
          return <BingLogo width={size} height={size} color={iconColor} />
        case 'local-google':
          return <GoogleOutlined size={size} style={{ color: iconColor, fontSize: size }} />
        default:
          return <Globe size={size} style={{ color: iconColor, fontSize: size }} />
      }
    },
    [enableWebSearch]
  )

  const updateSelectedWebSearchProvider = useCallback(
    async (providerId?: WebSearchProvider['id']) => {
      // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
      const currentWebSearchProviderId = assistant.webSearchProviderId
      const newWebSearchProviderId = currentWebSearchProviderId === providerId ? undefined : providerId
      startTransition(() => {
        updateAssistant({ ...assistant, webSearchProviderId: newWebSearchProviderId, enableWebSearch: false })
      })
    },
    [assistant, updateAssistant]
  )

  const updateSelectedWebSearchBuiltin = useCallback(async () => {
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
        action: () => updateSelectedWebSearchProvider(p.id)
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
        action: () => updateSelectedWebSearchBuiltin()
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
    updateSelectedWebSearchBuiltin,
    updateSelectedWebSearchProvider
  ])

  const openQuickPanel = useCallback(() => {
    if (assistant.webSearchProviderId) {
      updateSelectedWebSearchProvider(undefined)
      return
    }

    if (assistant.enableWebSearch) {
      updateSelectedWebSearchBuiltin()
      return
    }

    quickPanel.open({
      title: t('chat.input.web_search.label'),
      list: providerItems,
      symbol: '?',
      pageSize: 9
    })
  }, [
    assistant.webSearchProviderId,
    assistant.enableWebSearch,
    quickPanel,
    t,
    providerItems,
    updateSelectedWebSearchProvider,
    updateSelectedWebSearchBuiltin
  ])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '?') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      title={enableWebSearch ? t('common.close') : t('chat.input.web_search.label')}
      mouseLeaveDelay={0}
      arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <WebSearchIcon pid={assistant.webSearchProviderId} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(WebSearchButton)
