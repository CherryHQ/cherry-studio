import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { getProviderLogo } from '@renderer/config/providers'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import ImageStorage from '@renderer/services/ImageStorage'
import { INITIAL_PROVIDERS } from '@renderer/store/llm'
import { Provider, ProviderType } from '@renderer/types'
import {
  droppableReorder,
  generateColorFromChar,
  getFancyProviderName,
  getFirstCharacter,
  matchKeywordsInModel,
  matchKeywordsInProvider,
  uuid
} from '@renderer/utils'
import { Avatar, Button, Card, Dropdown, Input, MenuProps, Tag } from 'antd'
import { Eye, EyeOff, Search, UserPen } from 'lucide-react'
import { FC, startTransition, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import AddProviderPopup from './AddProviderPopup'
import ModelNotesPopup from './ModelNotesPopup'
import ProviderSetting from './ProviderSetting'

const logger = loggerService.withContext('ProvidersList')

const ProvidersList: FC = () => {
  const [searchParams] = useSearchParams()
  const providers = useAllProviders()
  const { updateProviders, addProvider, removeProvider, updateProvider } = useProviders()
  const [selectedProvider, _setSelectedProvider] = useState<Provider>(providers[0])
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})

  const setSelectedProvider = useCallback(
    (provider: Provider) => {
      startTransition(() => _setSelectedProvider(provider))
    },
    [_setSelectedProvider]
  )

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
            logger.error(`Failed to load logo for provider ${provider.id}`, error as Error)
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
  }, [providers, searchParams, setSelectedProvider])

  // Handle provider add key from URL schema
  useEffect(() => {
    const handleProviderAddKey = (data: {
      id: string
      apiKey: string
      baseUrl: string
      type?: ProviderType
      name?: string
    }) => {
      const { id, apiKey: newApiKey, baseUrl, type, name } = data

      // 查找匹配的 provider
      let existingProvider = providers.find((p) => p.id === id)
      const isNewProvider = !existingProvider

      if (!existingProvider) {
        existingProvider = {
          id,
          name: name || id,
          type: type || 'openai',
          apiKey: '',
          apiHost: baseUrl || '',
          models: [],
          enabled: true,
          isSystem: false
        }
      }

      const providerDisplayName = existingProvider.isSystem
        ? getProviderLabel(existingProvider.id)
        : existingProvider.name

      // 检查是否已有 API Key
      const hasExistingKey = existingProvider.apiKey && existingProvider.apiKey.trim() !== ''

      // 检查新的 API Key 是否已经存在
      const existingKeys = hasExistingKey ? existingProvider.apiKey.split(',').map((k) => k.trim()) : []
      const keyAlreadyExists = existingKeys.includes(newApiKey.trim())

      const confirmMessage = keyAlreadyExists
        ? t('settings.models.provider_key_already_exists', {
            provider: providerDisplayName,
            key: '*********'
          })
        : t('settings.models.provider_key_add_confirm', {
            provider: providerDisplayName,
            newKey: '*********'
          })

      const createModalContent = () => {
        let showApiKey = false

        const toggleApiKey = () => {
          showApiKey = !showApiKey
          // 重新渲染模态框内容
          updateModalContent()
        }

        const updateModalContent = () => {
          const content = (
            <ProviderInfoContainer>
              <ProviderInfoCard size="small">
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.provider_name')}:</ProviderInfoLabel>
                  <ProviderInfoValue>{providerDisplayName}</ProviderInfoValue>
                </ProviderInfoRow>
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.provider_id')}:</ProviderInfoLabel>
                  <ProviderInfoValue>{id}</ProviderInfoValue>
                </ProviderInfoRow>
                {baseUrl && (
                  <ProviderInfoRow>
                    <ProviderInfoLabel>{t('settings.models.base_url')}:</ProviderInfoLabel>
                    <ProviderInfoValue>{baseUrl}</ProviderInfoValue>
                  </ProviderInfoRow>
                )}
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.api_key')}:</ProviderInfoLabel>
                  <ApiKeyContainer>
                    <ApiKeyValue>{showApiKey ? newApiKey : '*********'}</ApiKeyValue>
                    <EyeButton onClick={toggleApiKey}>
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </EyeButton>
                  </ApiKeyContainer>
                </ProviderInfoRow>
              </ProviderInfoCard>
              <ConfirmMessage>{confirmMessage}</ConfirmMessage>
            </ProviderInfoContainer>
          )

          // 更新模态框内容
          if (modalInstance) {
            modalInstance.update({
              content: content
            })
          }
        }

        const modalInstance = window.modal.confirm({
          title: t('settings.models.provider_key_confirm_title', { provider: providerDisplayName }),
          content: (
            <ProviderInfoContainer>
              <ProviderInfoCard size="small">
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.provider_name')}:</ProviderInfoLabel>
                  <ProviderInfoValue>{providerDisplayName}</ProviderInfoValue>
                </ProviderInfoRow>
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.provider_id')}:</ProviderInfoLabel>
                  <ProviderInfoValue>{id}</ProviderInfoValue>
                </ProviderInfoRow>
                {baseUrl && (
                  <ProviderInfoRow>
                    <ProviderInfoLabel>{t('settings.models.base_url')}:</ProviderInfoLabel>
                    <ProviderInfoValue>{baseUrl}</ProviderInfoValue>
                  </ProviderInfoRow>
                )}
                <ProviderInfoRow>
                  <ProviderInfoLabel>{t('settings.models.api_key')}:</ProviderInfoLabel>
                  <ApiKeyContainer>
                    <ApiKeyValue>{showApiKey ? newApiKey : '*********'}</ApiKeyValue>
                    <EyeButton onClick={toggleApiKey}>
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </EyeButton>
                  </ApiKeyContainer>
                </ProviderInfoRow>
              </ProviderInfoCard>
              <ConfirmMessage>{confirmMessage}</ConfirmMessage>
            </ProviderInfoContainer>
          ),
          okText: keyAlreadyExists ? t('common.confirm') : t('common.add'),
          cancelText: t('common.cancel'),
          centered: true,
          onCancel() {
            window.navigate(`/settings/provider?id=${id}`)
          },
          onOk() {
            window.navigate(`/settings/provider?id=${id}`)
            if (keyAlreadyExists) {
              // 如果 key 已经存在，只显示消息，不做任何更改
              window.message.info(t('settings.models.provider_key_no_change', { provider: providerDisplayName }))
              return
            }

            // 如果 key 不存在，添加到现有 keys 的末尾
            const finalApiKey = hasExistingKey ? `${existingProvider.apiKey},${newApiKey.trim()}` : newApiKey.trim()

            const updatedProvider = {
              ...existingProvider,
              apiKey: finalApiKey,
              ...(baseUrl && { apiHost: baseUrl })
            }

            if (isNewProvider) {
              addProvider(updatedProvider)
            } else {
              updateProvider(updatedProvider)
            }

            setSelectedProvider(updatedProvider)
            window.message.success(t('settings.models.provider_key_added', { provider: providerDisplayName }))
          }
        })

        return modalInstance
      }

      createModalContent()
    }

    // 检查 URL 参数
    const addProviderData = searchParams.get('addProviderData')
    if (!addProviderData) {
      return
    }

    try {
      const { id, apiKey: newApiKey, baseUrl, type, name } = JSON.parse(addProviderData)
      if (!id || !newApiKey || !baseUrl) {
        window.message.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        window.navigate('/settings/provider')
        return
      }

      handleProviderAddKey({ id, apiKey: newApiKey, baseUrl, type, name })
    } catch (error) {
      window.message.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      window.navigate('/settings/provider')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
        logger.error('Failed to save logo', error as Error)
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

    const editMenu = {
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
                logger.error('Failed to save logo', error as Error)
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
                logger.error('Failed to reset logo', error as Error)
              }
            }
          }
        }
      }
    }

    const deleteMenu = {
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
                logger.error('Failed to delete logo', error as Error)
              }
            }

            setSelectedProvider(providers.filter((p) => p.isSystem)[0])
            removeProvider(provider)
          }
        })
      }
    }

    const menus = [editMenu, noteMenu, deleteMenu]

    if (providers.filter((p) => p.id === provider.id).length > 1) {
      return menus
    }

    if (provider.isSystem) {
      if (INITIAL_PROVIDERS.find((p) => p.id === provider.id)) {
        return [noteMenu]
      }
      return [noteMenu, deleteMenu]
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
    const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
    const isProviderMatch = matchKeywordsInProvider(keywords, provider)
    const isModelMatch = provider.models.some((model) => matchKeywordsInModel(keywords, model))
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
                                  {getFancyProviderName(provider)}
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
      <ProviderSetting providerId={selectedProvider.id} key={selectedProvider.id} />
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

const ProviderInfoContainer = styled.div`
  color: var(--color-text);
`

const ProviderInfoCard = styled(Card)`
  margin-bottom: 16px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);

  .ant-card-body {
    padding: 12px;
  }
`

const ProviderInfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
`

const ProviderInfoLabel = styled.span`
  font-weight: 600;
  color: var(--color-text-2);
  min-width: 80px;
`

const ProviderInfoValue = styled.span`
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  background-color: var(--color-background-soft);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  word-break: break-all;
  flex: 1;
  margin-left: 8px;
`

const ConfirmMessage = styled.div`
  color: var(--color-text);
  line-height: 1.5;
`

const ApiKeyContainer = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  margin-left: 8px;
  position: relative;
`

const ApiKeyValue = styled.span`
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  background-color: var(--color-background-soft);
  padding: 2px 32px 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  word-break: break-all;
  flex: 1;
`

const EyeButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 2px;
  transition: all 0.2s ease;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-mute);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary-outline);
  }
`

export default ProvidersList
