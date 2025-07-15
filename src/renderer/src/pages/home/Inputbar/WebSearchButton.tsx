import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { Assistant, WebSearchProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Tooltip } from 'antd'
import { Globe } from 'lucide-react'
import { FC, memo, useCallback, useImperativeHandle, useMemo } from 'react'
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

  const updateSelectedWebSearchProvider = useCallback(
    (providerId?: WebSearchProvider['id']) => {
      // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
      setTimeout(() => {
        const currentWebSearchProviderId = assistant.webSearchProviderId
        const newWebSearchProviderId = currentWebSearchProviderId === providerId ? undefined : providerId
        updateAssistant({ ...assistant, webSearchProviderId: newWebSearchProviderId, enableWebSearch: false })
      }, 200)
    },
    [assistant, updateAssistant]
  )

  const updateSelectedWebSearchBuiltin = useCallback(() => {
    // TODO: updateAssistant有性能问题，会导致关闭快捷面板卡顿
    setTimeout(() => {
      updateAssistant({ ...assistant, webSearchProviderId: undefined, enableWebSearch: !assistant.enableWebSearch })
    }, 200)
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
        icon: <Globe />,
        isSelected: p.id === assistant?.webSearchProviderId,
        disabled: !WebSearchService.isWebSearchEnabled(p.id),
        action: () => updateSelectedWebSearchProvider(p.id)
      }))
      .filter((o) => !o.disabled)

    if (isWebSearchModelEnabled) {
      items.unshift({
        label: t('chat.input.web_search.builtin'),
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
      return updateSelectedWebSearchProvider(undefined)
    }

    if (assistant.enableWebSearch) {
      return updateSelectedWebSearchBuiltin()
    }

    quickPanel.open({
      title: t('chat.input.web_search'),
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
      title={enableWebSearch ? t('common.close') : t('chat.input.web_search')}
      mouseLeaveDelay={0}
      arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <Globe
          size={18}
          style={{
            color: enableWebSearch ? 'var(--color-link)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(WebSearchButton)
