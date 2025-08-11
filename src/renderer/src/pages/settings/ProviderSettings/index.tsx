import { DropResult } from '@hello-pangea/dnd'
import { loggerService } from '@logger'
import { DraggableVirtualList, useDraggableReorder } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { getProviderLogo } from '@renderer/config/providers'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import ImageStorage from '@renderer/services/ImageStorage'
import { isSystemProvider, Provider, ProviderType } from '@renderer/types'
import {
  generateColorFromChar,
  getFancyProviderName,
  getFirstCharacter,
  matchKeywordsInModel,
  matchKeywordsInProvider,
  uuid
} from '@renderer/utils'
import { Avatar, Button, Card, Dropdown, Input, MenuProps, Splitter, Tag } from 'antd'
import { Eye, EyeOff, GripVertical, PlusIcon, Search, UserPen } from 'lucide-react'
import { FC, startTransition, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import AddProviderPopup from './AddProviderPopup'
import ModelNotesPopup from './ModelNotesPopup'
import ProviderSetting from './ProviderSetting'

const logger = loggerService.withContext('ProvidersList')

const BUTTON_WRAPPER_HEIGHT = 50

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

      const providerDisplayName = isSystemProvider(existingProvider)
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
      icon: <EditIcon size={14} />,
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
      icon: <DeleteIcon size={14} className="lucide-custom" />,
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

            setSelectedProvider(providers.filter((p) => isSystemProvider(p))[0])
            removeProvider(provider)
          }
        })
      }
    }

    const menus = [editMenu, noteMenu, deleteMenu]

    if (providers.filter((p) => p.id === provider.id).length > 1) {
      return menus
    }

    if (isSystemProvider(provider)) {
      return [noteMenu]
    } else if (provider.isSystem) {
      // 这里是处理数据中存在新版本删掉的系统提供商的情况
      // 未来期望能重构一下，不要依赖isSystem字段
      return [noteMenu, deleteMenu]
    } else {
      return menus
    }
  }

  const getProviderAvatar = (provider: Provider) => {
    const logoSrc = getProviderLogo(provider.id)
    if (logoSrc) {
      return <ProviderLogo draggable="false" shape="circle" src={logoSrc} size={25} />
    }

    const customLogo = providerLogos[provider.id]
    if (customLogo) {
      return <ProviderLogo draggable="false" shape="square" src={customLogo} size={25} />
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

  const { onDragEnd: handleReorder, itemKey } = useDraggableReorder({
    originalList: providers,
    filteredList: filteredProviders,
    onUpdate: updateProviders,
    idKey: 'id'
  })

  const handleDragStart = useCallback(() => {
    setDragging(true)
  }, [])

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      setDragging(false)
      handleReorder(result)
    },
    [handleReorder]
  )

  return (
    <Container className="selectable">
      <Splitter>
        <Splitter.Panel min={250} defaultSize={250}>
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
            <DraggableVirtualList
              list={filteredProviders}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              estimateSize={useCallback(() => 40, [])}
              itemKey={itemKey}
              overscan={3}
              style={{
                height: `calc(100% - 2 * ${BUTTON_WRAPPER_HEIGHT}px)`
              }}
              scrollerStyle={{
                padding: 8,
                paddingRight: 5
              }}
              itemContainerStyle={{ paddingBottom: 5 }}>
              {(provider) => (
                <Dropdown menu={{ items: getDropdownMenus(provider) }} trigger={['contextMenu']}>
                  <ProviderListItem
                    key={provider.id}
                    className={provider.id === selectedProvider?.id ? 'active' : ''}
                    onClick={() => setSelectedProvider(provider)}>
                    <DragHandle>
                      <GripVertical size={12} />
                    </DragHandle>
                    {getProviderAvatar(provider)}
                    <ProviderItemName className="text-nowrap">{getFancyProviderName(provider)}</ProviderItemName>
                    {provider.enabled && (
                      <Tag color="green" style={{ marginLeft: 'auto', marginRight: 0, borderRadius: 16 }}>
                        ON
                      </Tag>
                    )}
                  </ProviderListItem>
                </Dropdown>
              )}
            </DraggableVirtualList>
            <AddButtonWrapper>
              <Button
                style={{ width: '100%', borderRadius: 'var(--list-item-border-radius)' }}
                icon={<PlusIcon size={16} />}
                onClick={onAddProvider}
                disabled={dragging}>
                {t('button.add')}
              </Button>
            </AddButtonWrapper>
          </ProviderListContainer>
        </Splitter.Panel>

        <Splitter.Panel min={'50%'}>
          <ProviderSetting providerId={selectedProvider.id} key={selectedProvider.id} />
        </Splitter.Panel>
      </Splitter>
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
  height: calc(100vh - var(--navbar-height));
`

const ProviderListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5px 10px;
  width: 100%;
  border-radius: var(--list-item-border-radius);
  font-size: 14px;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;
  user-select: none;
  cursor: pointer;
  &:hover {
    background: var(--color-background-soft);
  }
  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    font-weight: bold !important;
  }
`

const DragHandle = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: -8px;
  width: 12px;
  color: var(--color-text-3);
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
  cursor: grab;

  ${ProviderListItem}:hover & {
    opacity: 1;
  }

  &:active {
    cursor: grabbing;
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
  height: ${BUTTON_WRAPPER_HEIGHT}px;
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
