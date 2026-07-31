import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils/style'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListGroup from './ModelListGroup'
import { useModelListHealthResults, useModelListHealthRun } from './modelListHealthContext'
import ModelListItem from './ModelListItem'
import type { ModelListGroupSection } from './useProviderModelList'

const MODEL_LIST_GROUP_ROW_ESTIMATE = 38
const MODEL_LIST_MODEL_ROW_ESTIMATE = 44
// A stable row keeps group spacing from moving between measured rows when a group collapses.
const MODEL_LIST_GROUP_SEPARATOR_HEIGHT = 10

interface ModelListSectionsProps {
  provider?: Provider
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  enabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  defaultModelIds: Set<UniqueModelId>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  bulkActionDisabled?: boolean
  expansionCommand?: { expanded: boolean; version: number }
  onContinueApiSetup?: () => void
}

type ModelListVirtualRow =
  | {
      type: 'group'
      key: string
      groupName: string
      items: ModelListGroupSection['items']
      defaultOpen: boolean
      open: boolean
    }
  | {
      type: 'model'
      key: string
      model: Model
      isLastInGroup: boolean
    }
  | {
      type: 'separator'
      key: string
    }

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  provider,
  isLoading,
  hasNoModels,
  hasVisibleModels,
  enabledSections,
  disabled,
  pendingModelIds,
  defaultModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
  bulkActionDisabled,
  expansionCommand,
  onContinueApiSetup
}) => {
  const { t } = useTranslation()
  const { modelStatusMap } = useModelListHealthResults()
  const { apiKeyEntries, savingKeyId, toggleApiKey } = useModelListHealthRun()
  const [groupOpenOverrides, setGroupOpenOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!expansionCommand) {
      return
    }

    setGroupOpenOverrides(
      Object.fromEntries(enabledSections.map(({ groupName }) => [groupName, expansionCommand.expanded]))
    )
  }, [enabledSections, expansionCommand])

  const toggleGroupOpen = useCallback((groupName: string, defaultOpen: boolean) => {
    setGroupOpenOverrides((current) => ({
      ...current,
      [groupName]: !(current[groupName] ?? defaultOpen)
    }))
  }, [])

  const virtualRows = useMemo<ModelListVirtualRow[]>(() => {
    return enabledSections.flatMap(({ groupName, items }, index) => {
      const defaultOpen = index <= 5
      const open = groupOpenOverrides[groupName] ?? defaultOpen
      const groupRow: ModelListVirtualRow = {
        type: 'group',
        key: `group:${groupName}`,
        groupName,
        items,
        defaultOpen,
        open
      }
      const separatorRow: ModelListVirtualRow = {
        type: 'separator',
        key: `separator:${groupName}`
      }

      if (!open) {
        return [groupRow, separatorRow]
      }

      return [
        groupRow,
        ...items.map(
          ({ model }, modelIndex): ModelListVirtualRow => ({
            type: 'model',
            key: `model:${model.id}`,
            model,
            isLastInGroup: modelIndex === items.length - 1
          })
        ),
        separatorRow
      ]
    })
  }, [enabledSections, groupOpenOverrides])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingIcon color="var(--muted-foreground)" />
      </div>
    )
  }

  if (hasNoModels) {
    return (
      <EmptyState
        compact
        title={t('settings.models.empty')}
        description={t(
          onContinueApiSetup ? 'settings.provider.api_setup.models_empty_hint' : 'settings.models.empty_hint'
        )}
        actionLabel={onContinueApiSetup ? t('settings.provider.api_setup.continue_models') : undefined}
        onAction={onContinueApiSetup}
        className="min-h-40"
      />
    )
  }

  if (!hasVisibleModels) {
    return <div className={modelListClasses.emptyState}>{t('common.no_results')}</div>
  }

  return (
    <DynamicVirtualList
      list={virtualRows}
      className={modelListClasses.listScroller}
      role="list"
      estimateSize={(index) => {
        const row = virtualRows[index]
        if (row?.type === 'group') return MODEL_LIST_GROUP_ROW_ESTIMATE
        if (row?.type === 'separator') return MODEL_LIST_GROUP_SEPARATOR_HEIGHT
        return MODEL_LIST_MODEL_ROW_ESTIMATE
      }}
      overscan={10}
      isSticky={(index) => virtualRows[index]?.type === 'group'}
      getItemKey={(index) => virtualRows[index]?.key ?? index}>
      {(row) => {
        if (row.type === 'separator') {
          return <div aria-hidden style={{ height: MODEL_LIST_GROUP_SEPARATOR_HEIGHT }} />
        }

        if (row.type === 'group') {
          return (
            <ModelListGroup
              groupName={row.groupName}
              items={row.items}
              defaultOpen={row.defaultOpen}
              open={row.open}
              disabled={disabled}
              bulkActionDisabled={bulkActionDisabled}
              pendingModelIds={pendingModelIds}
              defaultModelIds={defaultModelIds}
              onDeleteModels={onDeleteModels}
              onToggleOpen={() => toggleGroupOpen(row.groupName, row.defaultOpen)}
            />
          )
        }

        return (
          <div
            className={cn(modelListClasses.virtualModelRow, row.isLastInGroup && modelListClasses.virtualModelRowLast)}>
            <ModelListItem
              provider={provider}
              model={row.model}
              modelStatus={modelStatusMap.get(row.model.id)}
              apiKeyEntries={apiKeyEntries}
              savingKeyId={savingKeyId}
              onToggleApiKey={toggleApiKey}
              onEdit={onEditModel}
              onDelete={onDeleteModel}
              disabled={disabled || pendingModelIds.has(row.model.id)}
              isDefaultModel={defaultModelIds.has(row.model.id)}
            />
          </div>
        )
      }}
    </DynamicVirtualList>
  )
}

export default ModelListSections
