import { useReorder } from '@data/hooks/useReorder'
import { useProviderActions, useProviders } from '@renderer/hooks/useProviders'
import {
  isAnthropicSupportedProvider,
  isSystemProvider,
  matchKeywordsInProvider
} from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import ProviderEditorDrawer from './ProviderEditorDrawer'
import ProviderListAddButton from './ProviderListAddButton'
import ProviderListContent, { type ProviderListContentItemState } from './ProviderListContent'
import type { ProviderFilterMode } from './ProviderListHeaderBar'
import ProviderListHeaderBar from './ProviderListHeaderBar'
import ProviderListItemWithContextMenu from './ProviderListItemWithContextMenu'
import ProviderListSearchField from './ProviderListSearchField'
import { useProviderDelete } from './useProviderDelete'
import { useProviderEditor } from './useProviderEditor'
import { useProviderLogos } from './useProviderLogos'

const getIsOvmsSupported = async (): Promise<boolean> => {
  try {
    return await window.api.ovms.isSupported()
  } catch {
    return false
  }
}

export interface ProviderListProps {
  selectedProviderId?: string
  filterModeHint?: ProviderFilterMode
  onSelectProvider: (providerId: string) => void
}

export default function ProviderList({ selectedProviderId, filterModeHint, onSelectProvider }: ProviderListProps) {
  const { t } = useTranslation()
  const { providers, createProvider } = useProviders()
  const { logos: providerLogos, saveLogo, clearLogo } = useProviderLogos(providers)
  const { updateProviderById, deleteProviderById } = useProviderActions()
  const { applyReorderedList } = useReorder('/providers')

  const [filterMode, setFilterMode] = useState<ProviderFilterMode>(filterModeHint ?? 'all')
  const [searchText, setSearchText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [contextProviderId, setContextProviderId] = useState<string | null>(null)

  const {
    isOpen: editorOpen,
    editingProvider,
    startAdd,
    startEdit,
    cancel: cancelEditor,
    submit: submitEditor
  } = useProviderEditor({ createProvider, updateProviderById, saveLogo, clearLogo, onSelectProvider })

  const { deleteProvider } = useProviderDelete({ deleteProviderById, clearLogo, providers, onSelectProvider })

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>())

  const { data: isOvmsSupported } = useSWRImmutable('ovms/isSupported', getIsOvmsSupported)

  useEffect(() => {
    if (!filterModeHint) {
      return
    }

    setFilterMode(filterModeHint)
  }, [filterModeHint])

  const filteredProviders = useMemo(() => {
    return providers.filter((provider) => {
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

  useEffect(() => {
    if (!selectedProviderId) {
      return
    }

    const scrollSelectedItem = () => {
      itemRefs.current.get(selectedProviderId)?.scrollIntoView?.({
        block: 'center',
        behavior: 'smooth'
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

  const renderProviderItem = (provider: Provider, _index: number, state: ProviderListContentItemState) => {
    const showManagementActions = (providerCounts.get(provider.id) ?? 0) > 1 || !isSystemProvider(provider)
    return (
      <ProviderListItemWithContextMenu
        provider={provider}
        selectedProviderId={selectedProviderId}
        customLogos={providerLogos}
        contextOpen={contextProviderId === provider.id}
        onContextOpenChange={(open) => setContextProviderId(open ? provider.id : null)}
        onSelect={() => onSelectProvider(provider.id)}
        onEdit={() => startEdit(provider)}
        onDelete={() => void deleteProvider(provider)}
        showManagementActions={showManagementActions}
        listState={state}
        onSetListItemRef={setProviderItemRef}
      />
    )
  }

  return (
    <aside className="flex h-full w-[clamp(180px,20vw,250px)] shrink-0 basis-[clamp(180px,20vw,250px)] flex-col border-foreground/[0.05] border-r bg-(--color-sidebar)">
      <ProviderListHeaderBar
        filteredCount={filteredProviders.length}
        filterMode={filterMode}
        disabled={dragging}
        onFilterChange={setFilterMode}
      />
      <ProviderListSearchField value={searchText} disabled={dragging} onValueChange={setSearchText} />
      <ProviderListContent
        providers={providers}
        filteredProviders={filteredProviders}
        onDragStateChange={handleDragStateChange}
        onReorder={applyReorderedList}
        renderItem={renderProviderItem}
      />
      <ProviderListAddButton label={t('button.add')} disabled={dragging} onAdd={startAdd} />
      <ProviderEditorDrawer
        open={editorOpen}
        provider={editingProvider}
        initialLogo={editingProvider ? providerLogos[editingProvider.id] : undefined}
        onClose={cancelEditor}
        onSubmit={submitEditor}
      />
    </aside>
  )
}
