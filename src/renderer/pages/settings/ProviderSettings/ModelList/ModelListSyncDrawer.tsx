import { Badge, Button, Input, Tooltip } from '@cherrystudio/ui'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ListMinus, ListPlus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'
import { applyModelFilters, getCapabilityModelCounts, groupModels } from './modelListDerivedState'
import ModelSyncPreviewPanel from './ModelSyncPreviewPanel'
import { ModelTypeFilterTabs } from './ModelTypeFilterTabs'

type ModelManageFilter = ModelListCapabilityFilter | 'stale'

interface ModelListSyncDrawerProps {
  open: boolean
  provider?: Provider
  allModels: Model[]
  localModels: Model[]
  removableModelIds: UniqueModelId[]
  defaultModelIds?: UniqueModelId[]
  isLoading: boolean
  isApplying: boolean
  loadErrorMessage?: string | null
  staleModelCount?: number
  staleModelIds?: UniqueModelId[]
  onRetryLoadModels?: () => void | Promise<void>
  onAddModels: (models: Model[]) => void | Promise<void>
  onRemoveModels: (modelIds: UniqueModelId[]) => void | Promise<void>
  onCleanStaleModels?: () => void | Promise<void>
  onClose: () => void
}

export default function ModelListSyncDrawer({
  open,
  provider,
  allModels = [],
  localModels = [],
  removableModelIds = [],
  defaultModelIds = [],
  isLoading,
  isApplying,
  loadErrorMessage,
  staleModelCount = 0,
  staleModelIds = [],
  onRetryLoadModels,
  onAddModels,
  onRemoveModels,
  onCleanStaleModels,
  onClose
}: ModelListSyncDrawerProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [actualFilter, setActualFilter] = useState<ModelManageFilter>('all')

  useEffect(() => {
    setSearchText('')
    setActualFilter('all')
  }, [open])

  const localModelIds = useMemo(() => new Set(localModels.map((model) => model.id)), [localModels])
  const removableModelIdSet = useMemo(() => new Set(removableModelIds), [removableModelIds])
  const defaultModelIdSet = useMemo(() => new Set(defaultModelIds), [defaultModelIds])
  const staleModelIdSet = useMemo(() => new Set(staleModelIds), [staleModelIds])
  const filteredModels = useMemo(() => {
    if (actualFilter === 'stale') {
      return applyModelFilters(allModels, searchText, 'all').filter((model) => staleModelIdSet.has(model.id))
    }

    return applyModelFilters(allModels, searchText, actualFilter)
  }, [actualFilter, allModels, searchText, staleModelIdSet])
  const filteredGroups = useMemo(
    () => groupModels(filteredModels, Boolean(searchText.trim())),
    [filteredModels, searchText]
  )
  // Per-type counts over the search-filtered set (so the tabs track the search).
  const typeCounts = useMemo<ModelListCapabilityCounts>(
    () => getCapabilityModelCounts(applyModelFilters(allModels, searchText, 'all')),
    [allModels, searchText]
  )
  const isAllFilteredInProvider =
    filteredModels.length > 0 && filteredModels.every((model) => localModelIds.has(model.id))
  const removableFilteredModelIds = useMemo(
    () =>
      filteredModels
        .filter((model) => localModelIds.has(model.id) && removableModelIdSet.has(model.id))
        .map((model) => model.id),
    [filteredModels, localModelIds, removableModelIdSet]
  )
  const busy = isLoading || isApplying
  const hasLoadError = Boolean(loadErrorMessage)
  const drawerTitle = provider?.name
    ? `${provider.name} ${t('common.models')}`
    : t('settings.models.manage.drawer_title')
  const bulkActionLabel = isAllFilteredInProvider
    ? t('settings.models.manage.remove_listed')
    : t('settings.models.manage.add_listed.label')
  const cleanStaleLabel = t('settings.models.manage.clean_stale_models')

  useEffect(() => {
    if (staleModelCount === 0 && actualFilter === 'stale') {
      setActualFilter('all')
    }
  }, [actualFilter, staleModelCount])

  const handleBulkAction = useCallback(() => {
    if (isAllFilteredInProvider) {
      void onRemoveModels(removableFilteredModelIds)
      return
    }

    void onAddModels(filteredModels.filter((model) => !localModelIds.has(model.id)))
  }, [filteredModels, isAllFilteredInProvider, localModelIds, onAddModels, onRemoveModels, removableFilteredModelIds])

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={
        <span className={modelSyncClasses.manageTitle}>
          <span className={modelSyncClasses.manageTitleText}>{drawerTitle}</span>
          <Badge variant="secondary" className={modelSyncClasses.manageTitleCountBadge}>
            {allModels.length}
          </Badge>
        </span>
      }
      titleActions={
        <span className="flex items-center gap-1">
          {hasLoadError ? (
            <Tooltip content={loadErrorMessage} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={loadErrorMessage ?? t('common.refresh')}
                disabled={isLoading}
                loading={isLoading}
                className={modelSyncClasses.manageTitleErrorRetryButton}
                onClick={() => void onRetryLoadModels?.()}>
                {isLoading ? null : <RefreshCw className="size-3.5" />}
                <span className={modelSyncClasses.manageTitleErrorDot} />
              </Button>
            </Tooltip>
          ) : null}
          {staleModelCount > 0 && onCleanStaleModels ? (
            <Tooltip content={cleanStaleLabel} placement="top">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={cleanStaleLabel}
                disabled={busy}
                className={modelSyncClasses.manageTitleActionButton}
                onClick={() => void onCleanStaleModels()}>
                <Trash2 className="size-4" />
                <span>{cleanStaleLabel}</span>
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content={bulkActionLabel} placement="top">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={bulkActionLabel}
              disabled={
                busy ||
                filteredModels.length === 0 ||
                (isAllFilteredInProvider && removableFilteredModelIds.length === 0)
              }
              className={modelSyncClasses.manageTitleActionButton}
              onClick={handleBulkAction}>
              {isAllFilteredInProvider ? <ListMinus className="size-4" /> : <ListPlus className="size-4" />}
              <span>{bulkActionLabel}</span>
            </Button>
          </Tooltip>
        </span>
      }
      bodyClassName="flex flex-col space-y-0 overflow-hidden pt-0"
      contentClassName="w-[min(calc(100vw-24px),620px)]">
      <div className={modelSyncClasses.manageStickyHeader}>
        <div className={modelSyncClasses.manageToolbar}>
          <div className="relative min-w-0 flex-1">
            <Search className={modelSyncClasses.manageSearchIcon} />
            <Input
              type="text"
              value={searchText}
              placeholder={t('settings.models.manage.search_models_placeholder')}
              disabled={isLoading}
              onChange={(event) => setSearchText(event.target.value)}
              className={modelSyncClasses.manageSearchInput}
            />
            {searchText ? (
              <button
                type="button"
                onClick={() => setSearchText('')}
                className={modelSyncClasses.manageSearchClear}
                aria-label={t('common.clear')}>
                <X size={9} />
              </button>
            ) : null}
          </div>
        </div>

        <ModelTypeFilterTabs
          value={actualFilter}
          onValueChange={(next) => setActualFilter(next as ModelManageFilter)}
          counts={typeCounts}
          extraTabs={
            staleModelCount > 0
              ? [
                  {
                    value: 'stale',
                    label: t('settings.models.manage.stale_filter'),
                    count: staleModelCount,
                    destructive: true
                  }
                ]
              : []
          }
        />
      </div>

      <ModelSyncPreviewPanel
        modelGroups={filteredGroups}
        localModelIds={localModelIds}
        removableModelIds={removableModelIdSet}
        defaultModelIds={defaultModelIdSet}
        staleModelIds={staleModelIdSet}
        isLoading={isLoading}
        isApplying={isApplying}
        searchActive={Boolean(searchText.trim())}
        onAddModels={onAddModels}
        onRemoveModels={onRemoveModels}
      />
    </ProviderSettingsDrawer>
  )
}
