import { SettingOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import Scrollbar from '@renderer/components/Scrollbar'
import { getWebSearchProviderLogo } from '@renderer/config/webSearchProviders'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { WebSearchProvider } from '@renderer/types'
import { droppableReorder } from '@renderer/utils'
import { Avatar, Tag } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import BasicSettings from './BasicSettings'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchSettings: FC = () => {
  const { providers, updateWebSearchProviders } = useWebSearchProviders()
  console.log('providers', providers)
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<WebSearchProvider | null>(null)
  const [viewType, setViewType] = useState<'basic' | 'provider'>('basic')

  const [, setDragging] = useState(false)

  const onDragEnd = (result: DropResult) => {
    setDragging(false)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      const reorderProviders = droppableReorder<WebSearchProvider>(providers, sourceIndex, destIndex)
      updateWebSearchProviders(reorderProviders)
    }
  }

  const handleBasicClick = () => {
    setViewType('basic')
  }

  const handleProviderClick = (provider: WebSearchProvider) => {
    setSelectedProvider(provider)
    setViewType('provider')
  }

  return (
    <Container>
      <ProviderListContainer>
        <Scrollbar>
          <ProviderList>
            <ProviderListItem
              key={'basic'}
              style={{ marginBottom: 5 }}
              className={viewType === 'basic' ? 'active' : ''}
              onClick={handleBasicClick}>
              <SettingOutlined size={25} style={{ marginRight: '10px' }} />
              <div style={{ fontWeight: '500', fontFamily: 'Ubuntu' }}>{t('settings.general')}</div>
            </ProviderListItem>
            <DragDropContext onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
              <Droppable droppableId="droppable">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {providers.map((provider, index) => (
                      <Draggable key={`draggable_${provider.id}_${index}`} draggableId={provider.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{ ...provided.draggableProps.style, marginBottom: 5 }}>
                            <ProviderListItem
                              key={JSON.stringify(provider)}
                              className={
                                viewType === 'provider' && provider.id === selectedProvider?.id ? 'active' : ''
                              }
                              onClick={() => handleProviderClick(provider)}>
                              <ProviderLogo shape="square" src={getWebSearchProviderLogo(provider.id)} size={25} />
                              <ProviderItemName className="text-nowrap">{provider.name}</ProviderItemName>
                              {provider.enabled && (
                                <Tag color="green" style={{ marginLeft: 'auto', marginRight: 0, borderRadius: 16 }}>
                                  ON
                                </Tag>
                              )}
                            </ProviderListItem>
                          </div>
                        )}
                      </Draggable>
                    ))}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </ProviderList>
        </Scrollbar>
      </ProviderListContainer>

      {/* 根据当前视图类型显示不同的内容 */}
      {viewType === 'provider' && selectedProvider && (
        <WebSearchProviderSetting provider={selectedProvider} key={JSON.stringify(selectedProvider)} />
      )}
      {viewType === 'basic' && <BasicSettings key={'basic'} />}
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 2px 0;
`
const ProviderListContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-width: calc(var(--settings-width) + 10px);
  height: calc(100vh - var(--navbar-height));
  border-right: 0.5px solid var(--color-border);
`

const ProviderList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 8px;
  padding-right: 5px;
`

const ProviderListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5px 10px;
  width: 100%;
  cursor: grab;
  border-radius: var(--list-item-border-radius);
  font-size: 14px;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;
  &:hover {
    background: var(--color-background-soft);
  }
  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    font-weight: bold !important;
  }
`

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

const ProviderItemName = styled.div`
  margin-left: 10px;
  font-weight: 500;
  font-family: Ubuntu;
`

export default WebSearchSettings
