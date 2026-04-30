import { LoadingIcon } from '@renderer/components/Icons'
import { isEmpty } from 'lodash'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import ModelListGroup from './ModelListGroup'
import type { ModelListSectionsSurface } from './useProviderModelListBrowse'

interface ModelListSectionsProps {
  sections: ModelListSectionsSurface
}

const ModelListSections: React.FC<ModelListSectionsProps> = ({ sections }) => {
  const { t } = useTranslation()

  if (sections.isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingIcon color="var(--muted-foreground)" />
      </div>
    )
  }

  if (sections.hasNoModels) {
    return null
  }

  if (!sections.hasVisibleModels) {
    return <div className={modelListClasses.emptyState}>{t('common.no_results')}</div>
  }

  return (
    <div className={modelListClasses.listScroller}>
      <div className="flex min-h-full min-w-0 w-full flex-col gap-3">
        {!isEmpty(sections.enabledSections) && (
          <div className="space-y-2.5">
            <div className={modelListClasses.subsectionRow}>
              <p className={modelListClasses.subsectionTitleEnabled}>{t('settings.models.check.enabled')}</p>
              <span className={modelListClasses.subsectionRule} />
              <span className={modelListClasses.subsectionCountEnabled}>{sections.displayEnabledModelCount}</span>
            </div>
            <div className="flex flex-col gap-3">
              {sections.enabledSections.map(({ groupName, items }, index) => (
                <ModelListGroup
                  key={`enabled-${groupName}`}
                  groupName={groupName}
                  items={items}
                  defaultOpen={index <= 5}
                  disabled={sections.isHealthChecking}
                  pendingModelIds={sections.pendingModelIds}
                  onEditModel={sections.onEditModel}
                  onToggleModel={sections.onToggleModel}
                />
              ))}
            </div>
          </div>
        )}
        {!isEmpty(sections.disabledSections) && (
          <div className="space-y-2.5">
            <div className={modelListClasses.subsectionRow}>
              <p className={modelListClasses.subsectionTitleDisabled}>{t('settings.models.check.disabled')}</p>
              <span className={modelListClasses.subsectionRule} />
              <span className={modelListClasses.subsectionCountDisabled}>{sections.displayDisabledModelCount}</span>
            </div>
            <div className="flex flex-col gap-3">
              {sections.disabledSections.map(({ groupName, items }, index) => (
                <ModelListGroup
                  key={`disabled-${groupName}`}
                  groupName={groupName}
                  items={items}
                  defaultOpen={index <= 2}
                  disabled={sections.isHealthChecking}
                  pendingModelIds={sections.pendingModelIds}
                  onEditModel={sections.onEditModel}
                  onToggleModel={sections.onToggleModel}
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
