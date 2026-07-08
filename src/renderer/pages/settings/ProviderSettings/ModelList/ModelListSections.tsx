import LoadingIcon from '@renderer/components/icons/LoadingIcon'
import type { Model } from '@shared/data/types/model'
import { isEmpty } from 'es-toolkit/compat'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListGroup from './ModelListGroup'
import type { ModelListGroupSection } from './useProviderModelList'

interface ModelListSectionsProps {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  enabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  bulkActionDisabled?: boolean
  expansionCommand?: { expanded: boolean; version: number }
}

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  isLoading,
  hasNoModels,
  hasVisibleModels,
  enabledSections,
  disabled,
  pendingModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
  bulkActionDisabled,
  expansionCommand
}) => {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingIcon color="var(--muted-foreground)" />
      </div>
    )
  }

  if (hasNoModels) {
    return null
  }

  if (!hasVisibleModels) {
    return <div className={modelListClasses.emptyState}>{t('common.no_results')}</div>
  }

  return (
    <div className={modelListClasses.listScroller}>
      <div className="flex min-h-full w-full min-w-0 flex-col gap-2.5">
        {!isEmpty(enabledSections) && (
          <div>
            <div className="flex flex-col gap-3">
              {enabledSections.map(({ groupName, items }, index) => (
                <ModelListGroup
                  key={`enabled-${groupName}`}
                  groupName={groupName}
                  items={items}
                  defaultOpen={index <= 5}
                  disabled={disabled}
                  bulkActionDisabled={bulkActionDisabled}
                  pendingModelIds={pendingModelIds}
                  onEditModel={onEditModel}
                  onDeleteModel={onDeleteModel}
                  onDeleteModels={onDeleteModels}
                  expansionCommand={expansionCommand}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModelListSections
