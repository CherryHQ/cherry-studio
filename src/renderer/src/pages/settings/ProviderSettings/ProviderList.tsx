import { Button, MenuItem } from '@cherrystudio/ui'
import type { DropResult } from '@hello-pangea/dnd'
import { loggerService } from '@logger'
import {
  DraggableVirtualList,
  type DraggableVirtualListRef,
  useDraggableReorder
} from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import ImageStorage from '@renderer/services/ImageStorage'
import type { Provider, ProviderType } from '@renderer/types'
import { isSystemProvider } from '@renderer/types'
import { getFancyProviderName, matchKeywordsInModel, matchKeywordsInProvider, uuid } from '@renderer/utils'
import { isAnthropicSupportedProvider } from '@renderer/utils/provider'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { MenuProps } from 'antd'
import { Dropdown, Input, Tag } from 'antd'
import { Check, Filter, GripVertical, PlusIcon, Search, UserPen } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import AddProviderPopup from './AddProviderPopup'
import ModelNotesPopup from './ModelNotesPopup'
import ProviderSetting from './ProviderSetting'
import UrlSchemaInfoPopup from './UrlSchemaInfoPopup'

const logger = loggerService.withContext('ProviderList')

const BUTTON_WRAPPER_HEIGHT = 50

const getIsOvmsSupported = async (): Promise<boolean> => {
  try {
    const result = await window.api.ovms.isSupported()
    return result
  } catch (e) {
    logger.warn('Fetching isOvmsSupported failed. Fallback to false.', e as Error)
    return false
  }
}

interface ProviderListProps {
  /** Whether in onboarding mode for new users */
  isOnboarding?: boolean
}

const ProviderList: FC<ProviderListProps> = ({ isOnboarding = false }) => {
  // TODO: Define validateSearch in routes/settings/provider.tsx and replace with Route.useSearch()
  // for type-safe search params. Currently using untyped useSearch as a stopgap after removing react-router-dom.
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const providers = useAllProviders()
  const { updateProviders, addProvider, removeProvider, updateProvider } = useProviders()
  const { setTimeoutTimer } = useTimer()
  const [selectedProvider, _setSelectedProvider] = useState<Provider>(providers[0])
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [agentFilterEnabled, setAgentFilterEnabled] = useState(false)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})
  const listRef = useRef<DraggableVirtualListRef>(null)

  const { data: isOvmsSupported } = useSWRImmutable('ovms/isSupported', getIsOvmsSupported)

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

    void loadAllLogos()
  }, [providers])

  useEffect(() => {
    let shouldUpdate = false

    // Handle filter param first - when filter is enabled, ignore id param
    if (search.filter === 'agent') {
      setAgentFilterEnabled(true)
      shouldUpdate = true
    } else if (search.id) {
      const providerId = search.id
      const provider = providers.find((p) => p.id === providerId)
      if (provider) {
        setSelectedProvider(provider)
        // Scroll to the selected provider
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
      shouldUpdate = true
    }

    if (shouldUpdate) {
      // FIXME: Using navigate + Object.fromEntries to strip consumed params is a workaround.
      // Ideal: define validateSearch on the route so navigate({ search }) is fully typed,
      // and consumed params can be cleared without manual filtering or type casts.
      const restSearch = Object.fromEntries(Object.entries(search).filter(([key]) => key !== 'filter' && key !== 'id'))
      void navigate({ to: '/settings/provider', search: restSearch as Record<string, string>, replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, search.filter, search.id, navigate, setSelectedProvider, setTimeoutTimer])

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
      void navigate({ to: '/settings/provider', search: { id } })

      if (!updatedProvider) {
        return
      }

      if (isNew) {
        addProvider(updatedProvider)
      } else {
        updateProvider(updatedProvider)
      }

      setSelectedProvider(updatedProvider)
      window.toast.success(t('settings.models.provider_key_added', { provider: displayName }))
    }

    // Check URL parameters
    const addProviderData = search.addProviderData
    if (!addProviderData) {
      return
    }

    try {
      const { id, apiKey: newApiKey, baseUrl, type, name } = JSON.parse(addProviderData)
      if (!id || !newApiKey || !baseUrl) {
        window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
        return
      }

      void handleProviderAddKey({ id, apiKey: newApiKey, baseUrl, type, name })
    } catch (error) {
      window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.addProviderData])

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
        window.toast.error(t('message.error.save_provider_logo'))
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
                window.toast.error(t('message.error.update_provider_logo'))
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
            // Remove the provider logo before deleting the provider
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
      // Handle legacy system providers that were removed in newer versions but still exist in stored data
      // This should ideally be refactored in the future to avoid relying on the isSystem field
      return [noteMenu, deleteMenu]
    } else {
      return menus
    }
  }

  const filteredProviders = providers.filter((provider) => {
    // don't show it when isOvmsSupported is loading
    if (provider.id === 'ovms' && !isOvmsSupported) {
      return false
    }

    // Filter by agent support
    if (agentFilterEnabled && !isAnthropicSupportedProvider(provider)) {
      return false
    }

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
    <div className="selectable flex w-full flex-row justify-between">
      <div className="flex min-w-[calc(var(--settings-width)+10px)] flex-col border-r border-r-(--color-border) pb-1.25">
        <div className="flex h-12.5 flex-row items-center justify-center px-2 py-2.5">
          <Input
            type="text"
            placeholder={t('settings.provider.search')}
            value={searchText}
            style={{ borderRadius: 10, height: 35 }}
            prefix={<Search size={14} />}
            suffix={
              <Dropdown
                menu={{
                  items: [
                    {
                      label: t('settings.provider.filter.all'),
                      key: 'all',
                      icon: agentFilterEnabled ? <CheckPlaceholder /> : <Check size={14} />,
                      onClick: () => setAgentFilterEnabled(false)
                    },
                    {
                      label: t('settings.provider.filter.agent'),
                      key: 'agent',
                      icon: agentFilterEnabled ? <Check size={14} /> : <CheckPlaceholder />,
                      onClick: () => setAgentFilterEnabled(true)
                    }
                  ]
                }}
                trigger={['click']}>
                <div className="flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded-sm">
                  <Filter
                    size={14}
                    className={agentFilterEnabled ? 'text-(--color-primary)' : 'text-(--color-text-3)'}
                  />
                </div>
              </Dropdown>
            }
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
        </div>
        <DraggableVirtualList
          ref={listRef}
          list={filteredProviders}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          disableInteractiveElementBlocking
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
              <MenuItem
                key={provider.id}
                className="w-full cursor-pointer select-none overflow-hidden rounded-[10px] text-[14px] data-[active=true]:font-semibold"
                label={getFancyProviderName(provider)}
                active={provider.id === selectedProvider?.id}
                onClick={() => setSelectedProvider(provider)}
                icon={
                  <div className="flex items-center">
                    <div className="mr-0.5 flex w-3 cursor-grab items-center justify-center text-(--color-text-3) opacity-0 transition-opacity duration-200 ease-in-out active:cursor-grabbing group-hover:opacity-100">
                      <GripVertical size={12} />
                    </div>
                    <ProviderAvatar
                      style={{
                        width: 24,
                        height: 24
                      }}
                      provider={provider}
                      customLogos={providerLogos}
                    />
                  </div>
                }
                suffix={
                  provider.enabled ? (
                    <Tag color="green" style={{ marginLeft: 'auto', marginRight: 0, borderRadius: 16 }}>
                      ON
                    </Tag>
                  ) : undefined
                }
              />
            </Dropdown>
          )}
        </DraggableVirtualList>
        <div className="flex h-12.5 flex-row items-center justify-center px-2 py-2.5">
          <Button size="sm" style={{ width: '100%', borderRadius: 10 }} onClick={onAddProvider} disabled={dragging}>
            <PlusIcon size={16} />
            {t('button.add')}
          </Button>
        </div>
      </div>
      <ProviderSetting providerId={selectedProvider.id} key={selectedProvider.id} isOnboarding={isOnboarding} />
    </div>
  )
}

const CheckPlaceholder = () => <span className="inline-block h-3.5 w-3.5" />

export default ProviderList
