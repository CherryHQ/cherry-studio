import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import Scrollbar from '@renderer/components/Scrollbar'
import { getProviderLogo } from '@renderer/config/providers'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { droppableReorder, generateColorFromChar, getFirstCharacter, uuid } from '@renderer/utils'
import { Avatar, Button, Dropdown, Input, MenuProps, Tag } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddProviderPopup from './AddProviderPopup'
import ProviderSetting from './ProviderSetting'

const ProvidersList: FC = () => {
  const providers = useAllProviders()
  const { updateProviders, addProvider, removeProvider, updateProvider } = useProviders()
  const [selectedProvider, setSelectedProvider] = useState<Provider>(providers[0])
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState<string>('')
  const [dragging, setDragging] = useState(false)

  const onDragEnd = (result: DropResult) => {
    setDragging(false)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      const reorderProviders = droppableReorder<Provider>(providers, sourceIndex, destIndex)
      updateProviders(reorderProviders)
    }
  }

  const onAddProvider = async () => {
    const { name: prividerName, type } = await AddProviderPopup.show()

    if (!prividerName.trim()) {
      return
    }

    const provider = {
      id: uuid(),
      name: prividerName.trim(),
      type,
      apiKey: '',
      apiHost: '',
      models: [],
      enabled: true,
      isSystem: false
    } as Provider

    addProvider(provider)
    setSelectedProvider(provider)
  }

  const getDropdownMenus = (provider: Provider): MenuProps['items'] => {
    const menus = [
      {
        label: t('common.edit'),
        key: 'edit',
        icon: <EditOutlined />,
        async onClick() {
          const { name, type } = await AddProviderPopup.show(provider)
          name && updateProvider({ ...provider, name, type })
        }
      },
      {
        label: t('common.delete'),
        key: 'delete',
        icon: <DeleteOutlined />,
        danger: true,
        async onClick() {
          window.modal.confirm({
            title: t('settings.provider.delete.title'),
            content: t('settings.provider.delete.content'),
            okButtonProps: { danger: true },
            okText: t('common.delete'),
            centered: true,
            onOk: () => {
              setSelectedProvider(providers.filter((p) => p.isSystem)[0])
              removeProvider(provider)
            }
          })
        }
      }
    ]

    if (providers.filter((p) => p.id === provider.id).length > 1) {
      return menus
    }

    if (provider.isSystem) {
      return []
    }

    return menus
  }

  //will match the providers and the models that provider provides
  const filteredProviders = providers.filter((provider) => {
    // 获取 provider 的名称
    const providerName = provider.isSystem ? t(`provider.${provider.id}`) : provider.name

    // 检查 provider 的 id 和 name 是否匹配搜索条件
    const isProviderMatch =
      provider.id.toLowerCase().includes(searchText.toLowerCase()) ||
      providerName.toLowerCase().includes(searchText.toLowerCase())

    // 检查 provider.models 中是否有 model 的 id 或 name 匹配搜索条件
    const isModelMatch = provider.models.some((model) => {
      return (
        model.id.toLowerCase().includes(searchText.toLowerCase()) ||
        model.name.toLowerCase().includes(searchText.toLowerCase())
      )
    })

    // 如果 provider 或 model 匹配，则保留该 provider
    return isProviderMatch || isModelMatch
  })

  return (
    <Container>
      <ProviderListContainer>
        <AddButtonWrapper>
          <Input
            type="text"
            placeholder={t('settings.provider.search')}
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
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {filteredProviders.map((provider, index) => (
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
                                {provider.isSystem && (
                                  <ProviderLogo shape="square" src={getProviderLogo(provider.id)} size={25} />
                                )}
                                {!provider.isSystem && (
                                  <ProviderLogo
                                    size={25}
                                    shape="square"
                                    style={{ backgroundColor: generateColorFromChar(provider.name), minWidth: 25 }}>
                                    {getFirstCharacter(provider.name)}
                                  </ProviderLogo>
                                )}
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
        <AddButtonWrapper>
          <Button
            style={{ width: '100%', borderRadius: 'var(--list-item-border-radius)' }}
            icon={<PlusOutlined />}
            onClick={onAddProvider}
            disabled={dragging}>
            {t('button.add')}
          </Button>
        </AddButtonWrapper>
      </ProviderListContainer>
      <ProviderSetting provider={selectedProvider} key={JSON.stringify(selectedProvider)} />
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
export default ProvidersList
