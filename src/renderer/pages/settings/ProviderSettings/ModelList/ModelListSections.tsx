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
  disabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
  onToggleModels: (models: Model[], enabled: boolean) => Promise<void>
  bulkActionDisabled?: boolean
}

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  isLoading,
  hasNoModels,
  hasVisibleModels,
  enabledSections,
  disabledSections,
  disabled,
  pendingModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
  onToggleModel,
  onToggleModels,
  bulkActionDisabled
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
            <div className="flex flex-col gap-2">
              {enabledSections.map(({ groupName, items }, index) => (
                <ModelListGroup
                  key={`enabled-${groupName}`}
                  groupName={groupName}
                  items={items}
                  defaultOpen={index <= 5}
                  disabled={disabled}
                  bulkActionDisabled={bulkActionDisabled}
                  bulkToggleEnabled={false}
                  bulkToggleLabel={t('settings.models.group_disable')}
                  pendingModelIds={pendingModelIds}
                  onEditModel={onEditModel}
                  onDeleteModel={onDeleteModel}
                  onDeleteModels={onDeleteModels}
                  onToggleModel={onToggleModel}
                  onToggleModels={onToggleModels}
                />
              ))}
            </div>
          </div>
        )}
        {!isEmpty(disabledSections) && (
          <div>
            <div className="flex flex-col gap-2">
              {disabledSections.map(({ groupName, items }, index) => (
                <ModelListGroup
                  key={`disabled-${groupName}`}
                  groupName={groupName}
                  items={items}
                  defaultOpen={index <= 2}
                  disabled={disabled}
                  bulkActionDisabled={bulkActionDisabled}
                  bulkToggleEnabled
                  bulkToggleLabel={t('settings.models.group_enable')}
                  pendingModelIds={pendingModelIds}
                  onEditModel={onEditModel}
                  onDeleteModel={onDeleteModel}
                  onDeleteModels={onDeleteModels}
                  onToggleModel={onToggleModel}
                  onToggleModels={onToggleModels}
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
