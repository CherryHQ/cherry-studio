import { usePersistCache } from '@data/hooks/useCache'
import { useReorder } from '@data/hooks/useReorder'
import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import {
  isProviderPresetInstanceSource,
  matchKeywordsInProvider
} from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { toast } from '@renderer/services/toast'
import { isProviderSettingsListVisibleProvider } from '@renderer/utils/providerSettings'
import type { Provider } from '@shared/data/types/provider'
import { canManageProvider } from '@shared/utils/provider'
import { Plus } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOvmsSupport } from '../hooks/useOvmsSupport'
import type { ProviderFilterMode } from './providerFilterMode'
import { getGroupedPresetIds } from './providerGrouping'
import ProviderListContent, { type ProviderListContentItemState } from './ProviderListContent'
import ProviderListHeaderFilterMenu from './ProviderListHeaderFilterMenu'
import ProviderListItemWithContextMenu from './ProviderListItemWithContextMenu'
import ProviderListSearchField from './ProviderListSearchField'
import { useProviderDelete } from './useProviderDelete'
import { type ProviderCreationContext, type SubmitProviderEditorParams, useProviderEditor } from './useProviderEditor'

const ProviderEditorDrawer = lazy(() => import('./ProviderEditorDrawer'))

export interface ProviderListProps {
  selectedProviderId?: string
  filterModeHint?: ProviderFilterMode
  onSelectProvider: (providerId: string) => void
  onCustomProviderCreated?: (providerId: string, hasApiKey: boolean) => void
}

export default function ProviderList({
  selectedProviderId,
  filterModeHint,
  onSelectProvider,
  onCustomProviderCreated
}: ProviderListProps) {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { applyReorderedList } = useReorder('/providers', { revalidateOnSuccess: false })
  const { isSupported: isOvmsSupported } = useOvmsSupport()

  const [persistedFilterMode, setPersistedFilterMode] = usePersistCache('settings.provider.filter_mode')
  const [filterModeOverride, setFilterModeOverride] = useState<ProviderFilterMode | undefined>(filterModeHint)
  const filterMode = filterModeOverride ?? persistedFilterMode
  const [searchText, setSearchText] = useState('')
  const { models: allModels } = useModels(undefined, { fetchEnabled: Boolean(searchText.trim()) })
  const [dragging, setDragging] = useState(false)
  const [contextProviderId, setContextProviderId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  const handleToggleGroup = useCallback((presetProviderId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [presetProviderId]: !prev[presetProviderId] }))
  }, [])

  const handleProviderCreated = useCallback(
    (providerId: string, context: ProviderCreationContext) => {
      onSelectProvider(providerId)
      if (context.kind === 'custom') {
        onCustomProviderCreated?.(providerId, context.hasApiKey)
      }
    },
    [onCustomProviderCreated, onSelectProvider]
  )

  const {
    isOpen: editorOpen,
    mode: editorMode,
    initialLogo,
    startAdd,
    startAddFrom,
    startEdit,
    cancel: cancelEditor,
    submit: submitEditor
  } = useProviderEditor({ onProviderCreated: handleProviderCreated })
  const [editorActivated, setEditorActivated] = useState(false)
  const openProviderEditor = useCallback(() => {
    setEditorActivated(true)
    startAdd()
  }, [startAdd])
  const openProviderEditorFrom = useCallback(
    (provider: Provider) => {
      setEditorActivated(true)
      startAddFrom(provider)
    },
    [startAddFrom]
  )
  const openProviderEditorForEdit = useCallback(
    (provider: Provider) => {
      setEditorActivated(true)
      startEdit(provider)
    },
    [startEdit]
  )

  const { deleteProvider } = useProviderDelete()

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>())
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const lastProvidersRef = useRef(providers)
  const lastSelectedProviderIdRef = useRef(selectedProviderId)

  useEffect(() => {
    if (!filterModeHint) {
      return
    }

    setFilterModeOverride(filterModeHint)
  }, [filterModeHint])

  const handleFilterChange = useCallback(
    (mode: ProviderFilterMode) => {
      setFilterModeOverride(undefined)
      setPersistedFilterMode(mode)
    },
    [setPersistedFilterMode]
  )

  useEffect(() => {
    if (!selectedProviderId) return
    const selected = providers.find((p) => p.id === selectedProviderId)
    const preset = selected?.presetProviderId
    if (!preset) return
    setExpandedGroups((prev) => (prev[preset] ? prev : { ...prev, [preset]: true }))
  }, [providers, selectedProviderId])

  /**
   * Per-provider concatenated model-name/id haystack — folded into the
   * sidebar keyword search so a user can jump to a provider by typing a
   * model name. Skipped when there's no search input to avoid the work on
   * every render.
   */
  const providerModelsIndex = useMemo(() => {
    if (!searchText.trim()) return null
    const map = new Map<string, string>()
    for (const m of allModels) {
      const prev = map.get(m.providerId)
      const next = `${m.name} ${m.apiModelId ?? ''}`
      map.set(m.providerId, prev ? `${prev} ${next}` : next)
    }
    return map
  }, [allModels, searchText])

  const filteredProviders = useMemo(() => {
    const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
    return providers.filter((provider) => {
      if (!isProviderSettingsListVisibleProvider(provider)) {
        return false
      }
      if (provider.id === 'ovms' && !isOvmsSupported) {
        return false
      }
      if (filterMode === 'enabled' && !provider.isEnabled) {
        return false
      }
      if (filterMode === 'disabled' && provider.isEnabled) {
        return false
      }
      return matchKeywordsInProvider(keywords, provider, providerModelsIndex?.get(provider.id))
    })
  }, [filterMode, isOvmsSupported, providers, providerModelsIndex, searchText])

  const providerCounts = useMemo(
    () =>
      providers.reduce<Map<string, number>>((counts, provider) => {
        counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1)
        return counts
      }, new Map()),
    [providers]
  )

  const groupedPresetIds = useMemo(() => getGroupedPresetIds(filteredProviders), [filteredProviders])
  const presetSources = useMemo(
    () =>
      providers.filter(
        (provider) => isProviderPresetInstanceSource(provider) && isProviderSettingsListVisibleProvider(provider)
      ),
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

    // Skip the auto-scroll when the providers list reference itself changed
    // since the last effect run — i.e. a reorder / create / delete / update
    // landed — BUT the user's selection did not change. In that case, jumping
    // them back would be an unexpected scroll snap. If the selected item itself
    // changed (e.g. initial load, new provider created, or manual selection),
    // we always perform the scroll.
    const providersChanged = providers !== lastProvidersRef.current
    const selectionChanged = selectedProviderId !== lastSelectedProviderIdRef.current
    const wasEmpty = lastProvidersRef.current.length === 0
    lastProvidersRef.current = providers
    lastSelectedProviderIdRef.current = selectedProviderId
    if (providersChanged && !selectionChanged && !wasEmpty) {
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
  }, [providers, selectedProviderId])

  const handleDragStateChange = useCallback((nextDragging: boolean) => {
    setDragging(nextDragging)
    if (nextDragging) {
      setContextProviderId(null)
    }
  }, [])

  const handleReorderError = useCallback(() => {
    toast.error(t('settings.provider.reorder_failed'))
  }, [t])

  const handleSubmitEditor = useCallback(
    async (providerInput: SubmitProviderEditorParams) => {
      // Logo now saves atomically with the provider row, so any failure rejects
      // here and is surfaced by the drawer's submit catch — no separate notice.
      await submitEditor(providerInput)
    },
    [submitEditor]
  )

  const handleDeleteProvider = useCallback(
    async (providerId: Provider['id']) => {
      await ConfirmActionPopup.show({
        title: t('settings.provider.delete.title'),
        content: t('settings.provider.delete.content'),
        danger: true,
        okText: t('common.delete'),
        action: () => deleteProvider(providerId)
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
        onEdit={() => openProviderEditorForEdit(provider)}
        onDelete={() => handleDeleteProvider(provider.id)}
        onDuplicate={
          provider.presetProviderId && !groupedPresetIds.has(provider.presetProviderId)
            ? () => openProviderEditorFrom(provider)
            : undefined
        }
        showManagementActions={showManagementActions}
        listState={state}
        onSetListItemRef={setProviderItemRef}
      />
    )
  }

  const handleAddAnother = openProviderEditorFrom
  const addProviderButton = (
    <button
      type="button"
      aria-label={t('settings.provider.add.button_title')}
      disabled={dragging}
      onClick={openProviderEditor}
      className={providerListClasses.addButton}>
      <Plus size={14} strokeWidth={2.5} />
      <span>{t('settings.provider.add.button_title')}</span>
    </button>
  )

  return (
    <aside className={`${providerListClasses.shell}`}>
      <ProviderListSearchField
        value={searchText}
        disabled={dragging}
        onValueChange={setSearchText}
        trailing={
          <ProviderListHeaderFilterMenu
            filterMode={filterMode}
            disabled={dragging}
            triggerClassName={providerListClasses.searchInlineAddButton}
            triggerIconSize={12}
            onFilterChange={handleFilterChange}
          />
        }
      />
      <ProviderListContent
        providers={providers}
        visibleProviders={filteredProviders}
        selectedProviderId={selectedProviderId}
        searchActive={Boolean(searchText)}
        expandedGroups={expandedGroups}
        onToggleGroup={handleToggleGroup}
        onAddAnotherInGroup={handleAddAnother}
        scrollerRef={setScrollerRef}
        onDragStateChange={handleDragStateChange}
        onReorder={applyReorderedList}
        onReorderError={handleReorderError}
        renderItem={renderProviderItem}
      />
      <div className={providerListClasses.addFooter}>{addProviderButton}</div>
      {editorActivated ? (
        <Suspense fallback={null}>
          <ProviderEditorDrawer
            open={editorOpen}
            mode={editorMode}
            initialLogo={initialLogo}
            presetSources={presetSources}
            onClose={cancelEditor}
            onSelectPreset={startAddFrom}
            onSubmit={handleSubmitEditor}
          />
        </Suspense>
      ) : null}
    </aside>
  )
}
