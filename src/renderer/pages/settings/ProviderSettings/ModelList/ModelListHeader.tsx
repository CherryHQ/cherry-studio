import { SearchInput } from '@cherrystudio/ui'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses, ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'
import ModelListCapabilityChips from './ModelListCapabilityChips'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'

export interface ModelListHeaderProps {
  isBusy: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
  selectedCapabilityFilter: ModelListCapabilityFilter
  setSelectedCapabilityFilter: (filter: ModelListCapabilityFilter) => void
  capabilityOptions: readonly ModelListCapabilityFilter[]
  capabilityModelCounts: ModelListCapabilityCounts
  docsWebsite?: string
  modelsWebsite?: string
  actions?: React.ReactNode
}

const ModelListHeader: React.FC<ModelListHeaderProps> = ({
  isBusy,
  hasNoModels,
  searchText,
  setSearchText,
  selectedCapabilityFilter,
  setSelectedCapabilityFilter,
  capabilityOptions,
  capabilityModelCounts,
  docsWebsite,
  modelsWebsite,
  actions
}) => {
  const { t } = useTranslation()
  const docsLink = modelsWebsite || docsWebsite

  return (
    <div className={modelListClasses.headerToolStack}>
      <div className={modelListClasses.sectionTitleLine}>
        <h2 className={modelListClasses.sectionTitle}>{t('settings.models.list_title')}</h2>
        {docsLink ? (
          <div className={modelListClasses.titleHelpRow}>
            <ProviderHelpLink
              target="_blank"
              rel="noreferrer"
              href={docsLink}
              className={modelListClasses.titleHelpLink}>
              {t('settings.models.docs')}
            </ProviderHelpLink>
          </div>
        ) : null}
      </div>
      <div className={modelListClasses.titleRow}>
        <div className="flex min-w-0 flex-1">
          <div className={modelListClasses.titleWrap}>
            <SearchInput
              containerClassName={modelListClasses.searchWrap}
              className={modelListClasses.searchInput}
              value={searchText}
              placeholder={t('models.search.placeholder')}
              disabled={isBusy}
              onChange={(event) => setSearchText(event.target.value)}
              onClear={() => setSearchText('')}
              clearLabel={t('common.clear')}
            />
            {!hasNoModels ? (
              <ModelListCapabilityChips
                capabilityOptions={capabilityOptions}
                selectedCapabilityFilter={selectedCapabilityFilter}
                capabilityModelCounts={capabilityModelCounts}
                onSelectCapabilityFilter={setSelectedCapabilityFilter}
              />
            ) : null}
          </div>
        </div>
        <div className={modelListClasses.titleActions}>{actions}</div>
      </div>
    </div>
  )
}

export default ModelListHeader
