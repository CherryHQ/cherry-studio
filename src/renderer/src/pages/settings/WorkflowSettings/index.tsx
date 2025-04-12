import { SearchOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import Scrollbar from '@renderer/components/Scrollbar'
import { getWorkflowProviderLogo } from '@renderer/config/workflowProviders'
import { useAllWorkflowProviders, useWorkflowProviders } from '@renderer/hooks/useWorkflowProvider'
import ImageStorage from '@renderer/services/ImageStorage'
import { WorkflowProviderType } from '@renderer/types'
import { droppableReorder, generateColorFromChar, getFirstCharacter } from '@renderer/utils'
import { Avatar, Dropdown, Input, MenuProps, Tag } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WorkflowProviderSetting from './WorkflowProviderSetting'

const WorkflowProviderList: FC = () => {
  const { t } = useTranslation()
  const workflowProviders = useAllWorkflowProviders()
  const { updateWorkflowProviders } = useWorkflowProviders()
  const [selectedProvider, setSelectedProvider] = useState<WorkflowProviderType>(workflowProviders[0])
  const [dragging, setDragging] = useState(false)
  const [searchText, setSearchText] = useState<string>('')
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadAllLogos = async () => {
      const logos: Record<string, string> = {}
      for (const provider of workflowProviders) {
        if (provider.id) {
          try {
            const logoData = await ImageStorage.get(`workflowProvider-${provider.id}`)
            if (logoData) {
              logos[provider.id] = logoData
            }
          } catch (error) {
            console.error(`Failed to load logo for provider ${provider.id}`, error)
          }
        }
      }
      setProviderLogos(logos)
    }

    loadAllLogos()
  }, [workflowProviders])

  const onDragEnd = (result: DropResult) => {
    setDragging(false)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      const reorderProviders = droppableReorder<WorkflowProviderType>(workflowProviders, sourceIndex, destIndex)
      updateWorkflowProviders(reorderProviders)
    }
  }

  const getDropdownMenus = (provider: WorkflowProviderType): MenuProps['items'] => {
    console.log('getDropdownMenus', provider)
    const menus = []

    return menus
  }

  const getProviderAvatar = (provider: WorkflowProviderType) => {
    if (provider.isSystem) {
      return <ProviderLogo shape="square" src={getWorkflowProviderLogo(provider.id)} size={25} />
    }

    const customLogo = providerLogos[provider.id]
    if (customLogo) {
      return <ProviderLogo shape="square" src={customLogo} size={25} />
    }

    return (
      <ProviderLogo
        size={25}
        shape="square"
        style={{ backgroundColor: generateColorFromChar(provider.name), minWidth: 25 }}>
        {getFirstCharacter(provider.name)}
      </ProviderLogo>
    )
  }

  return (
    <Container className="selectable">
      <ProviderListContainer>
        <AddButtonWrapper>
          <Input
            type="text"
            placeholder={t('settings.workflow.search')}
            value={searchText}
            style={{ borderRadius: 'var(--list-item-border-radius)', height: 35 }}
            suffix={<SearchOutlined style={{ color: 'var(--color-text-3)' }} />}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchText('')
              }
            }}
            allowClear
            disabled={dragging}
          />
        </AddButtonWrapper>
        <Scrollbar>
          <ProviderList>
            <DragDropContext onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
              <Droppable droppableId="droppable">
                {(provider) => (
                  <div {...provider.droppableProps} ref={provider.innerRef}>
                    {workflowProviders.map((provider, index) => (
                      <Draggable
                        key={`draggable_${provider.id}_${index}`}
                        draggableId={provider.id}
                        index={index}
                        isDragDisabled={searchText.length > 0}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{ ...provided.draggableProps.style, marginBottom: 5 }}>
                            <Dropdown menu={{ items: getDropdownMenus(provider) }} trigger={['contextMenu']}>
                              <ProviderListItem
                                key={JSON.stringify(provider)}
                                className={provider.id === selectedProvider?.id ? 'active' : ''}
                                onClick={() => setSelectedProvider(provider)}>
                                {getProviderAvatar(provider)}
                                <ProviderItemName className="text-nowrap">
                                  {provider.isSystem ? t(`provider.${provider.id}`) : provider.name}
                                </ProviderItemName>
                                {provider.enabled && (
                                  <Tag color="green" style={{ marginLeft: 'auto', marginRight: 0, borderRadius: 16 }}>
                                    ON
                                  </Tag>
                                )}
                              </ProviderListItem>
                            </Dropdown>
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
      <WorkflowProviderSetting workflowProvider={selectedProvider} key={JSON.stringify(selectedProvider)} />
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
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

const AddButtonWrapper = styled.div`
  height: 50px;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 10px 8px;
`
export default WorkflowProviderList
