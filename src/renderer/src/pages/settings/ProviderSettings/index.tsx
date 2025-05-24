import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import Scrollbar from '@renderer/components/Scrollbar'
import { getProviderLogo } from '@renderer/config/providers'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import ImageStorage from '@renderer/services/ImageStorage'
import { Provider } from '@renderer/types'
import { droppableReorder, generateColorFromChar, getFirstCharacter, uuid } from '@renderer/utils'
import { Avatar, Button, Dropdown, Input, MenuProps, Tag } from 'antd'
import { Search, UserPen } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import AddProviderPopup from './AddProviderPopup'
import ModelNotesPopup from './ModelNotesPopup'
import ProviderSetting from './ProviderSetting'

const ProvidersList: FC = () => {
  const [searchParams] = useSearchParams()
  const providers = useAllProviders()
  const { updateProviders, addProvider, removeProvider, updateProvider } = useProviders()
  const [selectedProvider, setSelectedProvider] = useState<Provider>(providers[0])
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadAllLogos = async () => {
      const logos: Record<string, string> = {}
      for (const provider of providers) {
        if (provider.id) {
          try {
            const logoData = await ImageStorage.get(`provider-${provider.id}`)
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
  }, [providers])

  useEffect(() => {
    if (searchParams.get('id')) {
      const providerId = searchParams.get('id')
      const provider = providers.find((p) => p.id === providerId)
      if (provider) {
        setSelectedProvider(provider)
      } else {
        setSelectedProvider(providers[0])
      }
    }
  }, [providers, searchParams])

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
    const { name: providerName, type, logo } = await AddProviderPopup.show()

    if (!providerName.trim()) {
      return
    }

    const provider = {
      id: uuid(),
      name: providerName.trim(),
      type,
      apiKey: '',
      apiHost: '',
      models: [],
      enabled: true,
      isSystem: false
    } as Provider

    let updatedLogos = { ...providerLogos }
    if (logo) {
      try {
        await ImageStorage.set(`provider-${provider.id}`, logo)
        updatedLogos = {
          ...updatedLogos,
          [provider.id]: logo
        }
        setProviderLogos(updatedLogos)
      } catch (error) {
        console.error('Failed to save logo', error)
        window.message.error('保存Provider Logo失败')
      }
    }

    addProvider(provider)
    setSelectedProvider(provider)
  }

  const getDropdownMenus = (provider: Provider): MenuProps['items'] => {
    const noteMenu = {
      label: t('settings.provider.notes.title'),
      key: 'notes',
      icon: <UserPen size={14} />,
      onClick: () => ModelNotesPopup.show({ provider })
    }

    const menus = [
      {
        label: t('common.edit'),
        key: 'edit',
        icon: <EditOutlined />,
        async onClick() {
          const { name, type, logoFile, logo } = await AddProviderPopup.show(provider)

          if (name) {
            updateProvider({ ...provider, name, type })
            if (provider.id) {
              if (logoFile && logo) {
                try {
                  await ImageStorage.set(`provider-${provider.id}`, logo)
                  setProviderLogos((prev) => ({
                    ...prev,
                    [provider.id]: logo
                  }))
                } catch (error) {
                  console.error('Failed to save logo', error)
                  window.message.error('更新Provider Logo失败')
                }
              } else if (logo === undefined && logoFile === undefined) {
                try {
                  await ImageStorage.set(`provider-${provider.id}`, '')
                  setProviderLogos((prev) => {
                    const newLogos = { ...prev }
                    delete newLogos[provider.id]
                    return newLogos
                  })
                } catch (error) {
                  console.error('Failed to reset logo', error)
                }
              }
            }
          }
        }
      },
      noteMenu,
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
            onOk: async () => {
              // 删除provider前先清理其logo
              if (provider.id) {
                try {
                  await ImageStorage.remove(`provider-${provider.id}`)
                  setProviderLogos((prev) => {
                    const newLogos = { ...prev }
                    delete newLogos[provider.id]
                    return newLogos
                  })
                } catch (error) {
                  console.error('Failed to delete logo', error)
                }
              }

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
      return [noteMenu]
    }

    return menus
  }

  const getProviderAvatar = (provider: Provider) => {
    if (provider.isSystem) {
      return <ProviderLogo shape="circle" src={getProviderLogo(provider.id)} size={25} />
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

  const filteredProviders = providers.filter((provider) => {
    const providerName = provider.isSystem ? t(`provider.${provider.id}`) : provider.name

    const isProviderMatch =
      provider.id.toLowerCase().includes(searchText.toLowerCase()) ||
      providerName.toLowerCase().includes(searchText.toLowerCase())

    const isModelMatch = provider.models.some((model) => {
      return (
        model.id.toLowerCase().includes(searchText.toLowerCase()) ||
        model.name.toLowerCase().includes(searchText.toLowerCase())
      )
    })

    return isProviderMatch || isModelMatch
  })

  return (
    <Container className="selectable">
      <ProviderListContainer>
        <AddButtonWrapper>
          <Input
            type="text"
            placeholder={t('settings.provider.search')}
            value={searchText}
            style={{ borderRadius: 'var(--list-item-border-radius)', height: 35 }}
            suffix={<Search size={14} />}
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
`

const AddButtonWrapper = styled.div`
  height: 50px;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 10px 8px;
`
export default ProvidersList
