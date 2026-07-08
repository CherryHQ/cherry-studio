import { Badge, Button, Input, Tabs, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ListMinus, ListPlus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import type { ModelListCapabilityFilter } from './modelListDerivedState'
import { applyModelFilters, groupModels, MODEL_LIST_CAPABILITY_FILTERS } from './modelListDerivedState'
import ModelSyncPreviewPanel from './ModelSyncPreviewPanel'

interface ModelListSyncDrawerProps {
  open: boolean
  provider?: Provider
  allModels: Model[]
  localModels: Model[]
  isLoading: boolean
  isApplying: boolean
  onAddModels: (models: Model[]) => void | Promise<void>
  onRemoveModels: (modelIds: UniqueModelId[]) => void | Promise<void>
  onClose: () => void
}

export default function ModelListSyncDrawer({
  open,
  provider,
  allModels = [],
  localModels = [],
  isLoading,
  isApplying,
  onAddModels,
  onRemoveModels,
  onClose
}: ModelListSyncDrawerProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [actualFilter, setActualFilter] = useState<ModelListCapabilityFilter>('all')
  const [optimisticFilter, setOptimisticFilter] = useState<ModelListCapabilityFilter>('all')
  const [, startFilterTransition] = useTransition()

  useEffect(() => {
    setSearchText('')
    setActualFilter('all')
    setOptimisticFilter('all')
  }, [open])

  const localModelIds = useMemo(() => new Set(localModels.map((model) => model.id)), [localModels])
  const filteredModels = useMemo(
    () => applyModelFilters(allModels, searchText, actualFilter),
    [actualFilter, allModels, searchText]
  )
  const filteredGroups = useMemo(
    () => groupModels(filteredModels, Boolean(searchText.trim())),
    [filteredModels, searchText]
  )
  const isAllFilteredInProvider =
    filteredModels.length > 0 && filteredModels.every((model) => localModelIds.has(model.id))
  const busy = isLoading || isApplying
  const drawerTitle = provider?.name
    ? `${provider.name} ${t('common.models')}`
    : t('settings.models.manage.drawer_title')
  const bulkActionLabel = isAllFilteredInProvider
    ? t('settings.models.manage.remove_listed')
    : t('settings.models.manage.add_listed.label')

  const handleBulkAction = useCallback(() => {
    if (isAllFilteredInProvider) {
      void onRemoveModels(filteredModels.map((model) => model.id))
      return
    }

    void onAddModels(filteredModels.filter((model) => !localModelIds.has(model.id)))
  }, [filteredModels, isAllFilteredInProvider, localModelIds, onAddModels, onRemoveModels])

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
        <Tooltip content={bulkActionLabel} placement="top">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={bulkActionLabel}
            disabled={busy || filteredModels.length === 0}
            className={modelSyncClasses.manageTitleActionButton}
            onClick={handleBulkAction}>
            {isAllFilteredInProvider ? <ListMinus className="size-4" /> : <ListPlus className="size-4" />}
            <span>{bulkActionLabel}</span>
          </Button>
        </Tooltip>
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

        <Tabs
          value={optimisticFilter}
          onValueChange={(value) => {
            const next = value as ModelListCapabilityFilter
            setOptimisticFilter(next)
            startFilterTransition(() => setActualFilter(next))
          }}
          className={modelSyncClasses.manageTabs}>
          <TabsList className={modelSyncClasses.manageTabsList}>
            {MODEL_LIST_CAPABILITY_FILTERS.map((filter) => (
              <TabsTrigger key={filter} value={filter} className={modelSyncClasses.manageTabsTrigger}>
                {filter === 'all' ? t('models.all') : t(`models.type.${filter}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ModelSyncPreviewPanel
        modelGroups={filteredGroups}
        localModelIds={localModelIds}
        isLoading={isLoading}
        isApplying={isApplying}
        searchActive={Boolean(searchText.trim())}
        onAddModels={onAddModels}
        onRemoveModels={onRemoveModels}
      />
    </ProviderSettingsDrawer>
  )
}
