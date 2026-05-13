import { useReorder } from '@data/hooks/useReorder'
import { useModels } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProviders'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import {
  canManageProvider,
  isAnthropicSupportedProvider,
  isProviderSettingsListVisibleProvider,
  matchKeywordsInProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOvmsSupport } from '../hooks/useOvmsSupport'
import ProviderEditorDrawer from './ProviderEditorDrawer'
import ProviderListContent, { type ProviderListContentItemState } from './ProviderListContent'
import type { ProviderFilterMode } from './ProviderListHeaderBar'
import ProviderListHeaderBar from './ProviderListHeaderBar'
import ProviderListHeaderFilterMenu from './ProviderListHeaderFilterMenu'
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
  const { models: allModels } = useModels()
  const { applyReorderedList } = useReorder('/providers')
  const { isSupported: isOvmsSupported } = useOvmsSupport()

  const [filterMode, setFilterMode] = useState<ProviderFilterMode>(filterModeHint ?? 'enabled')
  const [searchText, setSearchText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [contextProviderId, setContextProviderId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const autoDefaultedFilterRef = useRef(false)

  const handleToggleGroup = useCallback((presetProviderId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [presetProviderId]: !prev[presetProviderId] }))
  }, [])

  const {
    isOpen: editorOpen,
    mode: editorMode,
    initialLogo,
    startAdd,
    startAddFrom,
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

  useEffect(() => {
    if (autoDefaultedFilterRef.current) return
    if (filterModeHint || providers.length === 0) return
    autoDefaultedFilterRef.current = true
    if (!providers.some((p) => p.isEnabled)) {
      setFilterMode('all')
    }
  }, [filterModeHint, providers])

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
   * model name (parity with v1, where models lived inline on the row).
   * Skipped when there's no search input to avoid the work on every render.
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
      if (filterMode === 'agent' && !isAnthropicSupportedProvider(provider)) {
        return false
      }
      const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
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

  const groupedPresetIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of filteredProviders) {
      if (p.presetProviderId) counts.set(p.presetProviderId, (counts.get(p.presetProviderId) ?? 0) + 1)
    }
    const ids = new Set<string>()
    for (const [presetId, count] of counts) if (count >= 2) ids.add(presetId)
    return ids
  }, [filteredProviders])

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
        onDuplicate={
          provider.presetProviderId && !groupedPresetIds.has(provider.presetProviderId)
            ? () => startAddFrom(provider)
            : undefined
        }
        showManagementActions={showManagementActions}
        listState={state}
        onSetListItemRef={setProviderItemRef}
      />
    )
  }

  const handleAddAnother = useCallback((template: Provider) => startAddFrom(template), [startAddFrom])

  return (
    <aside className={`provider-settings-default-scope ${providerListClasses.shell}`}>
      <ProviderListHeaderBar
        action={
          <button
            type="button"
            aria-label={t('settings.provider.add.title')}
            disabled={dragging}
            onClick={startAdd}
            className={providerListClasses.addIconButton}>
            <Plus size={14} />
          </button>
        }
      />
      <ProviderListSearchField
        value={searchText}
        disabled={dragging}
        onValueChange={setSearchText}
        trailing={
          <ProviderListHeaderFilterMenu filterMode={filterMode} disabled={dragging} onFilterChange={setFilterMode} />
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
      <ProviderEditorDrawer
        open={editorOpen}
        mode={editorMode}
        initialLogo={initialLogo}
        onClose={cancelEditor}
        onSubmit={handleSubmitEditor}
      />
    </aside>
  )
}
