import { Badge, Button, Tooltip } from '@cherrystudio/ui'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ListMinus, ListPlus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListSyncContent from './ModelListSyncContent'
import { useModelListSyncView } from './useModelListSyncView'

interface ModelListSyncDrawerProps {
  open: boolean
  provider?: Provider
  allModels: Model[]
  localModels: readonly Model[]
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
  allModels,
  localModels,
  removableModelIds,
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
  const view = useModelListSyncView({ models: allModels, staleModelIds, resetKey: open })
  const localModelIds = useMemo(() => new Set(localModels.map((model) => model.id)), [localModels])
  const removableModelIdSet = useMemo(() => new Set(removableModelIds), [removableModelIds])
  const defaultModelIdSet = useMemo(() => new Set(defaultModelIds), [defaultModelIds])
  const isAllFilteredInProvider = useMemo(
    () => view.filteredModels.length > 0 && view.filteredModels.every((model) => localModelIds.has(model.id)),
    [localModelIds, view.filteredModels]
  )
  const removableFilteredModelIds = useMemo(
    () =>
      view.filteredModels
        .filter((model) => localModelIds.has(model.id) && removableModelIdSet.has(model.id))
        .map((model) => model.id),
    [localModelIds, removableModelIdSet, view.filteredModels]
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

  const handleBulkAction = useCallback(() => {
    if (isAllFilteredInProvider) {
      void onRemoveModels(removableFilteredModelIds)
      return
    }

    void onAddModels(view.filteredModels.filter((model) => !localModelIds.has(model.id)))
  }, [
    isAllFilteredInProvider,
    localModelIds,
    onAddModels,
    onRemoveModels,
    removableFilteredModelIds,
    view.filteredModels
  ])

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
                view.filteredModels.length === 0 ||
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
      <ModelListSyncContent
        mode="manage"
        provider={provider}
        view={view}
        localModelIds={localModelIds}
        removableModelIds={removableModelIdSet}
        defaultModelIds={defaultModelIdSet}
        isLoading={isLoading}
        isApplying={isApplying}
        onAddModels={onAddModels}
        onRemoveModels={onRemoveModels}
      />
    </ProviderSettingsDrawer>
  )
}
