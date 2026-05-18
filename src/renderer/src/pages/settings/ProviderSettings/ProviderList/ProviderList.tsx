import { useReorder } from '@data/hooks/useReorder'
import { useProviders } from '@renderer/hooks/useProviders'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import {
  canManageProvider,
  isAnthropicSupportedProvider,
  isProviderSettingsListVisibleProvider,
  matchKeywordsInProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOvmsSupport } from '../hooks/useOvmsSupport'
import ProviderEditorDrawer from './ProviderEditorDrawer'
import ProviderListAddButton from './ProviderListAddButton'
import ProviderListContent, { type ProviderListContentItemState } from './ProviderListContent'
import type { ProviderFilterMode } from './ProviderListHeaderBar'
import ProviderListHeaderBar from './ProviderListHeaderBar'
import ProviderListItemWithContextMenu from './ProviderListItemWithContextMenu'
import ProviderListSearchField from './ProviderListSearchField'
import { useProviderDelete } from './useProviderDelete'
import { type SubmitProviderEditorParams, useProviderEditor } from './useProviderEditor'

export interface ProviderListProps {
  selectedProviderId?: string
  filterModeHint?: ProviderFilterMode
  onSelectProvider: (providerId: string) => void
}

export default function ProviderList({ selectedProviderId, filterModeHint, onSelectProvider }: ProviderListProps) {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { applyReorderedList } = useReorder('/providers')
  const { isSupported: isOvmsSupported } = useOvmsSupport()

  const [filterMode, setFilterMode] = useState<ProviderFilterMode>(filterModeHint ?? 'all')
  const [searchText, setSearchText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [contextProviderId, setContextProviderId] = useState<string | null>(null)

  const {
    isOpen: editorOpen,
    editingProvider,
    initialLogo,
    startAdd,
    startEdit,
    cancel: cancelEditor,
    submit: submitEditor
  } = useProviderEditor({ onProviderCreated: onSelectProvider })

  const { deleteProvider } = useProviderDelete()

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>())
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!filterModeHint) {
      return
    }

    setFilterMode(filterModeHint)
  }, [filterModeHint])

  const filteredProviders = useMemo(() => {
    return providers.filter((provider) => {
      if (!isProviderSettingsListVisibleProvider(provider)) {
        return false
      }
      if (provider.id === 'ovms' && !isOvmsSupported) {
        return false
      }
      if (filterMode === 'agent' && !isAnthropicSupportedProvider(provider)) {
        return false
      }
      const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
      return matchKeywordsInProvider(keywords, provider)
    })
  }, [filterMode, isOvmsSupported, providers, searchText])

  const enabledProviders = useMemo(
    () => filteredProviders.filter((provider) => provider.isEnabled),
    [filteredProviders]
  )

  const disabledProviders = useMemo(
    () => filteredProviders.filter((provider) => !provider.isEnabled),
    [filteredProviders]
  )

  const providerCounts = useMemo(
    () =>
      providers.reduce<Map<string, number>>((counts, provider) => {
        counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1)
        return counts
      }, new Map()),
    [providers]
  )

  const setProviderItemRef = useCallback((providerId: string, element: HTMLDivElement | null) => {
    if (element) {
      itemRefs.current.set(providerId, element)
      return
    }

    itemRefs.current.delete(providerId)
  }, [])

  const setScrollerRef = useCallback((element: HTMLDivElement | null) => {
    scrollerRef.current = element
  }, [])

  useEffect(() => {
    if (!selectedProviderId) {
      return
    }

    const scrollSelectedItem = () => {
      const selectedItem = itemRefs.current.get(selectedProviderId)
      const scroller = scrollerRef.current

      if (!selectedItem || !scroller) {
        return
      }

      const itemRect = selectedItem.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const isFullyVisible = itemRect.top >= scrollerRect.top && itemRect.bottom <= scrollerRect.bottom

      if (isFullyVisible) {
        return
      }

      selectedItem.scrollIntoView?.({
        block: 'nearest',
        behavior: 'auto'
      })
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      scrollSelectedItem()
      return
    }

    const frameId = window.requestAnimationFrame(scrollSelectedItem)
    return () => window.cancelAnimationFrame(frameId)
  }, [filteredProviders, selectedProviderId])

  const handleDragStateChange = useCallback((nextDragging: boolean) => {
    setDragging(nextDragging)
    if (nextDragging) {
      setContextProviderId(null)
    }
  }, [])

  const handleReorderError = useCallback(() => {
    window.toast.error(t('settings.provider.reorder_failed'))
  }, [t])

  const handleSubmitEditor = useCallback(
    async (providerInput: SubmitProviderEditorParams) => {
      const result = await submitEditor(providerInput)

      if (result.notice === 'create-logo-save-failed') {
        window.toast.error(t('message.error.save_provider_logo'))
      } else if (result.notice === 'update-logo-save-failed') {
        window.toast.error(t('message.error.update_provider_logo'))
      }
    },
    [submitEditor, t]
  )

  const handleDeleteProvider = useCallback(
    (providerId: Provider['id']) => {
      window.modal.confirm({
        title: t('settings.provider.delete.title'),
        content: t('settings.provider.delete.content'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        centered: true,
        onOk: async () => {
          await deleteProvider(providerId)
        }
      })
    },
    [deleteProvider, t]
  )

  const renderProviderItem = (provider: Provider, _index: number, state: ProviderListContentItemState) => {
    const showManagementActions = (providerCounts.get(provider.id) ?? 0) > 1 || canManageProvider(provider)
    const selected = provider.id === selectedProviderId

    return (
      <ProviderListItemWithContextMenu
        provider={provider}
        selected={selected}
        contextOpen={contextProviderId === provider.id}
        onContextOpenChange={(open) => setContextProviderId(open ? provider.id : null)}
        onSelect={() => onSelectProvider(provider.id)}
        onEdit={() => startEdit(provider)}
        onDelete={() => handleDeleteProvider(provider.id)}
        showManagementActions={showManagementActions}
        listState={state}
        onSetListItemRef={setProviderItemRef}
      />
    )
  }

  return (
    <aside className={`provider-settings-default-scope ${providerListClasses.shell}`}>
      <ProviderListHeaderBar filterMode={filterMode} disabled={dragging} onFilterChange={setFilterMode} />
      <ProviderListSearchField value={searchText} disabled={dragging} onValueChange={setSearchText} />
      <ProviderListContent
        providers={providers}
        enabledProviders={enabledProviders}
        disabledProviders={disabledProviders}
        scrollerRef={setScrollerRef}
        onDragStateChange={handleDragStateChange}
        onReorder={applyReorderedList}
        onReorderError={handleReorderError}
        renderItem={renderProviderItem}
      />
      <ProviderListAddButton label={t('settings.provider.add.title')} disabled={dragging} onAdd={startAdd} />
      <ProviderEditorDrawer
        open={editorOpen}
        provider={editingProvider}
        initialLogo={initialLogo}
        onClose={cancelEditor}
        onSubmit={handleSubmitEditor}
      />
    </aside>
  )
}
