import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@cherrystudio/ui'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelSyncPreviewPanel from './ModelSyncPreviewPanel'
import { ModelTypeFilterTabs } from './ModelTypeFilterTabs'
import type { ModelListSyncView } from './useModelListSyncView'

interface ModelListSyncContentCommonProps {
  provider?: Provider
  view: ModelListSyncView
  isLoading: boolean
  isApplying: boolean
  disabled?: boolean
  toolbarAction?: ReactNode
  hideEmptyFilters?: boolean
  flattenSingleGroup?: boolean
}

interface ModelListSyncManageContentProps extends ModelListSyncContentCommonProps {
  mode: 'manage'
  localModelIds: Set<UniqueModelId>
  removableModelIds: Set<UniqueModelId>
  defaultModelIds: Set<UniqueModelId>
  onAddModels: (models: Model[]) => void | Promise<void>
  onRemoveModels: (modelIds: UniqueModelId[]) => void | Promise<void>
}

interface ModelListSyncSelectContentProps extends ModelListSyncContentCommonProps {
  mode: 'select'
  localModelIds: Set<UniqueModelId>
  selectedModelIds: Set<UniqueModelId>
  onSelectModels: (modelIds: UniqueModelId[], selected: boolean) => void
}

type ModelListSyncContentProps = ModelListSyncManageContentProps | ModelListSyncSelectContentProps

export default function ModelListSyncContent(props: ModelListSyncContentProps) {
  const { t } = useTranslation()
  const {
    provider,
    view,
    isLoading,
    isApplying,
    disabled = false,
    toolbarAction,
    hideEmptyFilters = false,
    flattenSingleGroup = false
  } = props
  const interactionDisabled = disabled || isLoading || isApplying
  const searchDisabled = disabled || isLoading || (props.mode === 'select' && isApplying)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div hidden={isLoading} className={modelSyncClasses.manageStickyHeader}>
        <div className={modelSyncClasses.manageToolbar}>
          <div className="relative min-w-0 flex-1">
            <Search className={modelSyncClasses.manageSearchIcon} />
            <Input
              type="text"
              value={view.searchText}
              aria-label={t('common.search')}
              placeholder={t('settings.models.manage.search_models_placeholder')}
              disabled={searchDisabled}
              onChange={(event) => view.setSearchText(event.target.value)}
              className={modelSyncClasses.manageSearchInput}
            />
            {view.searchText ? (
              <button
                type="button"
                disabled={searchDisabled}
                onClick={() => view.setSearchText('')}
                className={modelSyncClasses.manageSearchClear}
                aria-label={t('common.clear')}>
                <X size={9} />
              </button>
            ) : null}
          </div>
          {toolbarAction ?? null}
        </div>

        <ModelTypeFilterTabs
          value={view.actualFilter}
          onValueChange={(next) => view.setActualFilter(next as typeof view.actualFilter)}
          counts={view.typeCounts}
          hideEmptyFilters={hideEmptyFilters}
          extraTabs={
            props.mode === 'manage' && view.staleModelIdSet.size > 0
              ? [
                  {
                    value: 'stale',
                    label: t('settings.models.manage.stale_filter'),
                    count: view.staleModelIdSet.size,
                    destructive: true
                  }
                ]
              : []
          }
        />
      </div>

      {props.mode === 'manage' ? (
        <ModelSyncPreviewPanel
          mode="manage"
          provider={provider}
          modelGroups={view.filteredGroups}
          localModelIds={props.localModelIds}
          removableModelIds={props.removableModelIds}
          defaultModelIds={props.defaultModelIds}
          staleModelIds={view.staleModelIdSet}
          isLoading={isLoading}
          isApplying={interactionDisabled}
          searchActive={Boolean(view.searchText.trim())}
          flattenSingleGroup={flattenSingleGroup}
          onAddModels={props.onAddModels}
          onRemoveModels={props.onRemoveModels}
        />
      ) : (
        <ModelSyncPreviewPanel
          mode="select"
          provider={provider}
          modelGroups={view.filteredGroups}
          localModelIds={props.localModelIds}
          selectedModelIds={props.selectedModelIds}
          isLoading={isLoading}
          isApplying={interactionDisabled}
          searchActive={Boolean(view.searchText.trim())}
          flattenSingleGroup={flattenSingleGroup}
          onSelectModels={props.onSelectModels}
        />
      )}
    </div>
  )
}
