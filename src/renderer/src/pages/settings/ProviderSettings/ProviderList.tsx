import { DropResult } from '@hello-pangea/dnd'
import { loggerService } from '@logger'
import {
  DraggableVirtualList,
  type DraggableVirtualListRef,
  useDraggableReorder
} from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon, PoeLogo } from '@renderer/components/Icons'
import { getProviderLogo } from '@renderer/config/providers'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import ImageStorage from '@renderer/services/ImageStorage'
import { isSystemProvider, Provider, ProviderType } from '@renderer/types'
import {
  generateColorFromChar,
  getFancyProviderName,
  getFirstCharacter,
  getForegroundColor,
  matchKeywordsInModel,
  matchKeywordsInProvider,
  uuid
} from '@renderer/utils'
import { Avatar, Button, Dropdown, Input, MenuProps, Tag } from 'antd'
import { GripVertical, PlusIcon, Search, UserPen } from 'lucide-react'
import { FC, startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import AddProviderPopup from './AddProviderPopup'
import ModelNotesPopup from './ModelNotesPopup'
import ProviderSetting from './ProviderSetting'
import UrlSchemaInfoPopup from './UrlSchemaInfoPopup'

const logger = loggerService.withContext('ProviderList')

const BUTTON_WRAPPER_HEIGHT = 50

const ProviderList: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const providers = useAllProviders()
  const { updateProviders, addProvider, removeProvider, updateProvider } = useProviders()
  const { setTimeoutTimer } = useTimer()
  const [selectedProvider, _setSelectedProvider] = useState<Provider>(providers[0])
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})
  const listRef = useRef<DraggableVirtualListRef>(null)

  const setSelectedProvider = useCallback((provider: Provider) => {
    startTransition(() => _setSelectedProvider(provider))
  }, [])

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
        // 滚动到选中的 provider
        const index = providers.findIndex((p) => p.id === providerId)
        if (index >= 0) {
          setTimeoutTimer(
            'scroll-to-selected-provider',
            () => listRef.current?.scrollToIndex(index, { align: 'center' }),
            100
          )
        }
      } else {
        setSelectedProvider(providers[0])
      }
      searchParams.delete('id')
      setSearchParams(searchParams)
    }
  }, [providers, searchParams, setSearchParams, setSelectedProvider, setTimeoutTimer])

  // Handle provider add key from URL schema
  useEffect(() => {
    const handleProviderAddKey = async (data: {
      id: string
      apiKey: string
      baseUrl: string
      type?: ProviderType
      name?: string
    }) => {
      const { id } = data

      const { updatedProvider, isNew, displayName } = await UrlSchemaInfoPopup.show(data)
      window.navigate(`/settings/provider?id=${id}`)

      if (!updatedProvider) {
        return
      }

      if (isNew) {
        addProvider(updatedProvider)
      } else {
        updateProvider(updatedProvider)
      }

      setSelectedProvider(updatedProvider)
      window.message.success(t('settings.models.provider_key_added', { provider: displayName }))
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
            if (logo) {
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

  const getProviderAvatar = (provider: Provider, size: number = 25) => {
    // 特殊处理一下svg格式
    if (isSystemProvider(provider)) {
      switch (provider.id) {
        case 'poe':
          return <PoeLogo fontSize={size} />
      }
    }

    const logoSrc = getProviderLogo(provider.id)
    if (logoSrc) {
      return <ProviderLogo draggable="false" shape="circle" src={logoSrc} size={size} />
    }

    const customLogo = providerLogos[provider.id]
    if (customLogo) {
      return <ProviderLogo draggable="false" shape="square" src={customLogo} size={size} />
    }

    // generate color for custom provider
    const backgroundColor = generateColorFromChar(provider.name)
    const color = provider.name ? getForegroundColor(backgroundColor) : 'white'

    return (
      <ProviderLogo size={size} shape="square" style={{ backgroundColor, color, minWidth: size }}>
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
    itemKey: 'id'
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
                e.stopPropagation()
                setSearchText('')
              }
            }}
            allowClear
            disabled={dragging}
          />
        </AddButtonWrapper>
        <DraggableVirtualList
          ref={listRef}
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
  padding-bottom: 5px;
  border-right: 0.5px solid var(--color-border);
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

export default ProviderList
