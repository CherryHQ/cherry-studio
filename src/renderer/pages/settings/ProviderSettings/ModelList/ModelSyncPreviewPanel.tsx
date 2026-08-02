// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import { ChevronRight, CircleHelp, Minus, Plus } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, Badge, Button, Checkbox, EmptyState, Spinner, Tooltip } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { getModelLogoRef } from '@renderer/utils/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import ModelTagsWithLabel, { type ModelTagsWithLabelModel } from '../components/ModelTagsWithLabel'
import { modelListClasses, modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import { getModelGroupLabel } from './grouping'
import type { ModelGroups } from './modelListDerivedState'

interface ModelSyncPreviewPanelCommonProps {
  provider?: Provider
  modelGroups: ModelGroups
  localModelIds: Set<UniqueModelId>
  isLoading: boolean
  isApplying: boolean
  searchActive?: boolean
  flattenSingleGroup?: boolean
}

interface ModelSyncPreviewPanelManageProps extends ModelSyncPreviewPanelCommonProps {
  mode: 'manage'
  removableModelIds: Set<UniqueModelId>
  defaultModelIds: Set<UniqueModelId>
  staleModelIds: Set<UniqueModelId>
  onAddModels: (models: Model[]) => void | Promise<void>
  onRemoveModels: (modelIds: UniqueModelId[]) => void | Promise<void>
}

interface ModelSyncPreviewPanelSelectProps extends ModelSyncPreviewPanelCommonProps {
  mode: 'select'
  selectedModelIds: Set<UniqueModelId>
  onSelectModels: (modelIds: UniqueModelId[], selected: boolean) => void
}

type ModelSyncPreviewPanelProps = ModelSyncPreviewPanelManageProps | ModelSyncPreviewPanelSelectProps

type ManageVirtualRow =
  | {
      key: string
      type: 'group'
      groupName: string
      groupLabel: string
      models: Model[]
      collapsed: boolean
    }
  | {
      key: string
      type: 'model'
      model: Model
    }

function modelIdLine(model: Model) {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

const ModelGlyph = memo(function ModelGlyph({ model }: { model: Model }) {
  const Icon = useIcon(getModelLogoRef(model))
  if (Icon) {
    return (
      <span className={modelListClasses.rowAvatar}>
        <Icon.Avatar size={26} shape="circle" />
      </span>
    )
  }

  return (
    <Avatar className={modelListClasses.rowAvatar}>
      <AvatarFallback className="rounded-[inherit]">{model.name?.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
})

const ModelRowIdentity = memo(function ModelRowIdentity({
  model,
  provider,
  isStale = false
}: {
  model: Model
  provider?: Provider
  isStale?: boolean
}) {
  const { t } = useTranslation()
  const apiModelId = modelIdLine(model)
  const apiModelIdId = `${model.id}-api-model-id`

  return (
    <>
      <ModelGlyph model={model} />
      <div className="min-w-0 flex-1">
        <div className={modelSyncClasses.manageRowTitleLine}>
          {/* Friendly names can collide, so the raw id must remain keyboard- and screen-reader-accessible. */}
          <Tooltip content={apiModelId} placement="top" classNames={{ placeholder: 'min-w-0' }}>
            <p tabIndex={0} aria-describedby={apiModelIdId} className={modelSyncClasses.manageRowTitle}>
              {model.name || apiModelId}
            </p>
          </Tooltip>
          <span id={apiModelIdId} className="sr-only">
            {apiModelId}
          </span>
          {model.description ? (
            <Tooltip content={model.description} placement="top">
              <span tabIndex={0} aria-label={model.description} className={modelSyncClasses.manageRowDescriptionHelp}>
                <CircleHelp aria-hidden className="size-3" />
              </span>
            </Tooltip>
          ) : null}
          {isStale ? (
            <Badge variant="secondary" className={modelSyncClasses.manageStaleBadge}>
              {t('settings.models.manage.stale_badge')}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className={modelSyncClasses.fetchCapabilityStrip}>
        <ModelTagsWithLabel
          model={model as ModelTagsWithLabelModel}
          provider={provider}
          size={12}
          style={{ flexWrap: 'nowrap' }}
        />
      </div>
    </>
  )
})

const ManageModelRow = memo(function ManageModelRow({
  model,
  provider,
  isAdded,
  isRemovable,
  isDefaultModel,
  isStale,
  isApplying,
  onAddModels,
  onRemoveModels
}: {
  model: Model
  provider?: Provider
  isAdded: boolean
  isRemovable: boolean
  isDefaultModel: boolean
  isStale: boolean
  isApplying: boolean
  onAddModels: (models: Model[]) => void | Promise<void>
  onRemoveModels: (modelIds: UniqueModelId[]) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionTooltip = isAdded
    ? isDefaultModel
      ? t('settings.models.manage.default_model_cannot_remove')
      : t('settings.models.manage.remove_model')
    : t('button.add')

  return (
    <div className={modelSyncClasses.manageRow} data-added={isAdded}>
      <ModelRowIdentity model={model} provider={provider} isStale={isStale} />
      <Tooltip content={actionTooltip} placement="top">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isAdded ? t('settings.models.manage.remove_model') : t('button.add')}
          disabled={isApplying || (isAdded && !isRemovable)}
          className={modelSyncClasses.manageRowAction}
          onClick={() => {
            if (isAdded) {
              if (isRemovable) {
                void onRemoveModels([model.id])
              }
              return
            }
            void onAddModels([model])
          }}>
          {isAdded ? <Minus className="size-4" /> : <Plus className="size-4" />}
        </Button>
      </Tooltip>
    </div>
  )
})

const SelectModelRow = memo(function SelectModelRow({
  model,
  provider,
  isSelected,
  isApplying,
  onSelectModels
}: {
  model: Model
  provider?: Provider
  isSelected: boolean
  isApplying: boolean
  onSelectModels: (modelIds: UniqueModelId[], selected: boolean) => void
}) {
  const { t } = useTranslation()
  const label = model.name || modelIdLine(model)
  const checkboxId = `provider-api-setup-model-${encodeURIComponent(model.id)}`

  return (
    <label
      htmlFor={checkboxId}
      className={cn(modelSyncClasses.manageRow, 'cursor-pointer', isApplying && 'cursor-default opacity-60')}>
      <ModelRowIdentity model={model} provider={provider} />
      <Checkbox
        id={checkboxId}
        checked={isSelected}
        disabled={isApplying}
        aria-label={t('settings.provider.api_setup.select_model', { model: label })}
        onCheckedChange={(checked) => onSelectModels([model.id], checked === true)}
      />
    </label>
  )
})

export default function ModelSyncPreviewPanel(props: ModelSyncPreviewPanelProps) {
  const { t } = useTranslation()
  const {
    provider,
    modelGroups,
    localModelIds,
    isLoading,
    isApplying,
    searchActive = false,
    flattenSingleGroup = false
  } = props
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const entries = useMemo(() => Object.entries(modelGroups).filter(([, models]) => models.length > 0), [modelGroups])
  const virtualRows = useMemo<ManageVirtualRow[]>(() => {
    if (flattenSingleGroup && entries.length === 1) {
      return entries[0][1].map(
        (model): ManageVirtualRow => ({
          key: `model:${model.id}`,
          type: 'model',
          model
        })
      )
    }

    return entries.flatMap(([groupName, models]) => {
      const collapsed = !searchActive && collapsedGroups.has(groupName)
      const groupLabel = getModelGroupLabel(groupName, t)
      const groupRow: ManageVirtualRow = {
        key: `group:${groupName}`,
        type: 'group',
        groupName,
        groupLabel,
        models,
        collapsed
      }

      if (collapsed) {
        return [groupRow]
      }

      return [
        groupRow,
        ...models.map(
          (model): ManageVirtualRow => ({
            key: `model:${model.id}`,
            type: 'model',
            model
          })
        )
      ]
    })
  }, [collapsedGroups, entries, flattenSingleGroup, searchActive, t])

  const toggleGroup = useCallback((groupName: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }, [])

  const renderGroupAction = (models: Model[], groupLabel: string) => {
    if (props.mode === 'select') {
      const selectedCount = models.filter((model) => props.selectedModelIds.has(model.id)).length
      const checked = selectedCount === models.length ? true : selectedCount > 0 ? 'indeterminate' : false
      const shouldSelect = checked !== true

      return (
        <Checkbox
          checked={checked}
          disabled={isApplying}
          aria-label={`${t('common.select_all')}: ${groupLabel}`}
          onCheckedChange={() =>
            props.onSelectModels(
              models.map((model) => model.id),
              shouldSelect
            )
          }
        />
      )
    }

    const isAllInProvider = models.every((model) => localModelIds.has(model.id))
    const removableGroupModelIds = models
      .filter((model) => localModelIds.has(model.id) && props.removableModelIds.has(model.id))
      .map((model) => model.id)
    const title = isAllInProvider
      ? t('settings.models.manage.remove_whole_group')
      : t('settings.models.manage.add_whole_group')

    return (
      <Tooltip content={title} placement="top">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={title}
          disabled={isApplying || (isAllInProvider && removableGroupModelIds.length === 0)}
          className={modelSyncClasses.manageRowAction}
          onClick={(event) => {
            event.stopPropagation()
            if (isAllInProvider) {
              void props.onRemoveModels(removableGroupModelIds)
              return
            }
            void props.onAddModels(models.filter((model) => !localModelIds.has(model.id)))
          }}>
          {isAllInProvider ? <Minus className="size-4" /> : <Plus className="size-4" />}
        </Button>
      </Tooltip>
    )
  }

  if (isLoading) {
    return (
      <div className={modelSyncClasses.manageLoading}>
        <Spinner text={t('common.loading')} />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        preset={searchActive ? 'no-result' : 'no-model'}
        title={searchActive ? t('common.no_results') : t('settings.models.empty')}
        className="min-h-52"
      />
    )
  }

  return (
    <DynamicVirtualList
      list={virtualRows}
      className={modelSyncClasses.manageScrollArea}
      role="list"
      estimateSize={() => 44}
      itemContainerStyle={{ height: 44 }}
      overscan={5}
      isSticky={(index) => virtualRows[index]?.type === 'group'}
      getItemKey={(index) => virtualRows[index]?.key ?? index}>
      {(row) => {
        if (row.type === 'group') {
          return (
            <div className={modelSyncClasses.manageVirtualGroupRow}>
              <div
                className={cn(
                  modelSyncClasses.manageGroupHeaderSurface,
                  row.collapsed && modelSyncClasses.manageGroupHeaderSurfaceCollapsed
                )}>
                <button
                  type="button"
                  className={modelSyncClasses.manageGroupToggle}
                  aria-expanded={!row.collapsed}
                  onClick={() => toggleGroup(row.groupName)}>
                  <ChevronRight
                    className={cn(modelSyncClasses.manageGroupChevron, !row.collapsed && 'rotate-90')}
                    aria-hidden
                  />
                  <span className={modelSyncClasses.manageGroupTitle}>{row.groupLabel}</span>
                  <Badge variant="secondary" className={modelSyncClasses.manageGroupBadge}>
                    {row.models.length}
                  </Badge>
                </button>
                <span className="ml-auto pr-2">{renderGroupAction(row.models, row.groupLabel)}</span>
              </div>
            </div>
          )
        }

        return (
          <div className={modelSyncClasses.manageVirtualModelRow}>
            {props.mode === 'manage' ? (
              <ManageModelRow
                provider={provider}
                model={row.model}
                isAdded={localModelIds.has(row.model.id)}
                isRemovable={props.removableModelIds.has(row.model.id)}
                isDefaultModel={props.defaultModelIds.has(row.model.id)}
                isStale={props.staleModelIds.has(row.model.id)}
                isApplying={isApplying}
                onAddModels={props.onAddModels}
                onRemoveModels={props.onRemoveModels}
              />
            ) : (
              <SelectModelRow
                provider={provider}
                model={row.model}
                isSelected={props.selectedModelIds.has(row.model.id)}
                isApplying={isApplying}
                onSelectModels={props.onSelectModels}
              />
            )}
          </div>
        )
      }}
    </DynamicVirtualList>
  )
}
