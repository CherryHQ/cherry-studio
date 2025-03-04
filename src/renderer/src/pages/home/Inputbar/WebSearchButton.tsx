import { GlobalOutlined } from '@ant-design/icons'
import { isWebSearchModel } from '@renderer/config/models'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { Assistant, Model, WebSearchProvider } from '@renderer/types'
import { Popover, Select, SelectProps, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  selectedWebSearchProvider?: WebSearchProvider
  onSelect: (provider?: WebSearchProvider) => void
  model: Model
  assistant: Assistant
  onEnableWebSearch?: () => void
  disabled?: boolean
  ToolbarButton?: any
}

const WebSearchSelector: FC<Props> = ({ selectedWebSearchProvider, onSelect }) => {
  const { t } = useTranslation()
  const providers = useWebSearchProviders()

  const searchOptions: SelectProps['options'] = providers.map((provider) => ({
    label: provider.name,
    value: provider.id
  }))

  return (
    <SelectorContainer>
      {providers.length === 0 ? (
        <EmptyMessage>{t('settings.websearch.no_providers')}</EmptyMessage>
      ) : (
        <Select
          allowClear
          value={selectedWebSearchProvider?.id}
          placeholder={t('settings.websearch.select_provider')}
          options={searchOptions}
          style={{ width: '150px' }}
          onChange={(selectedId: string) => {
            const selectedProvider = providers.find((p) => p.id === selectedId)
            onSelect(selectedProvider)
          }}
          filterOption={(input, option) =>
            String(option?.label ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
        />
      )}
    </SelectorContainer>
  )
}

const WebSearchButton: FC<Props> = ({
  selectedWebSearchProvider,
  onSelect,
  model,
  assistant,
  onEnableWebSearch,
  disabled,
  ToolbarButton
}) => {
  const { t } = useTranslation()

  // 检查是否支持网络搜索
  const supportsWebSearch = isWebSearchModel(model)
  const webSearchEnabled = WebSearchService.isWebSearchEnabled()

  // 如果不支持网络搜索且功能也未启用，则不显示按钮
  if (!supportsWebSearch && !webSearchEnabled) {
    return null
  }

  // 计算按钮状态
  const isActive = assistant.enableWebSearch
  const iconColor = isActive ? 'var(--color-link)' : 'var(--color-icon)'

  // 如果支持网络搜索模型，则只显示简单的开关按钮
  if (supportsWebSearch) {
    return (
      <Tooltip placement="top" title={t('chat.input.web_search')} arrow>
        <ToolbarButton type="text" onClick={onEnableWebSearch}>
          <GlobalOutlined style={{ color: iconColor }} />
        </ToolbarButton>
      </Tooltip>
    )
  }

  // 否则，显示带有提供商选择的按钮
  return (
    <Tooltip placement="top" title={t('chat.input.web_search')} arrow>
      <Popover
        placement="top"
        content={
          <WebSearchSelector
            selectedWebSearchProvider={selectedWebSearchProvider}
            onSelect={onSelect}
            model={model}
            assistant={assistant}
          />
        }
        overlayStyle={{ maxWidth: 400 }}
        trigger="click">
        <ToolbarButton type="text" disabled={disabled}>
          <GlobalOutlined style={{ color: selectedWebSearchProvider ? iconColor : 'var(--color-icon)' }} />
        </ToolbarButton>
      </Popover>
    </Tooltip>
  )
}

const SelectorContainer = styled.div`
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const EmptyMessage = styled.div`
  padding: 8px;
`

export default WebSearchButton
