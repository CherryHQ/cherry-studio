import { LoadingIcon } from '@renderer/components/Icons'
import type { Model } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListGroup from './ModelListGroup'
import type { ModelListGroupSection } from './useProviderModelList'

interface ModelListSectionsProps {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  displayEnabledModelCount: number
  enabledSections: ModelListGroupSection[]
  disabledSections: ModelListGroupSection[]
  displayDisabledModelCount: number
  disabled: boolean
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
  onToggleModels: (models: Model[], enabled: boolean) => Promise<void>
  bulkActionDisabled?: boolean
  expansionCommand?: { expanded: boolean; version: number }
  enabledSectionActions?: React.ReactNode
  disabledSectionActions?: React.ReactNode
}

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  isLoading,
  hasNoModels,
  hasVisibleModels,
  displayEnabledModelCount,
  enabledSections,
  disabledSections,
  displayDisabledModelCount,
  disabled,
  pendingModelIds,
  onEditModel,
  onToggleModel,
  onToggleModels,
  bulkActionDisabled,
  expansionCommand,
  enabledSectionActions,
  disabledSectionActions
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
          <div className="space-y-2">
            <div className={modelListClasses.subsectionRow}>
              <div className={modelListClasses.subsectionTitleWrap}>
                <p className={modelListClasses.subsectionTitleEnabled}>{t('settings.models.enabled_models')}</p>
                <span className={modelListClasses.subsectionCountEnabled}>{displayEnabledModelCount}</span>
                {enabledSectionActions ? (
                  <div className={modelListClasses.subsectionActions}>{enabledSectionActions}</div>
                ) : null}
              </div>
            </div>
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
                  onToggleModel={onToggleModel}
                  onToggleModels={onToggleModels}
                  expansionCommand={expansionCommand}
                />
              ))}
            </div>
          </div>
        )}
        {!isEmpty(disabledSections) && (
          <div className="space-y-2">
            <div className={modelListClasses.subsectionRow}>
              <div className={modelListClasses.subsectionTitleWrap}>
                <p className={modelListClasses.subsectionTitleDisabled}>{t('settings.models.not_enabled_models')}</p>
                <span className={modelListClasses.subsectionCountDisabled}>{displayDisabledModelCount}</span>
                {disabledSectionActions ? (
                  <div className={modelListClasses.subsectionActions}>{disabledSectionActions}</div>
                ) : null}
              </div>
            </div>
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
                  onToggleModel={onToggleModel}
                  onToggleModels={onToggleModels}
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
