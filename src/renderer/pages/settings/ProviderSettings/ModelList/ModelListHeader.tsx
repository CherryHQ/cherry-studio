import { HStack, VStack } from '@cherrystudio/ui'
import { Search, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
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
  actions
}) => {
  const { t } = useTranslation()
  const totalModelCount = capabilityModelCounts.all ?? 0

  return (
    <VStack gap={6} className="w-full min-w-0">
      <HStack justify="between" wrap gap={3} className="w-full min-w-0">
        <HStack align="baseline" gap={3} className="min-w-0">
          <h2 className={modelListClasses.sectionTitle}>{t('settings.models.list_title')}</h2>
          <span className={modelListClasses.countMeta}>
            {t('settings.models.available_count', { count: totalModelCount })}
          </span>
        </HStack>
        <HStack justify="end" wrap gap={2} className="max-w-full flex-1">
          <div className={modelListClasses.searchWrap}>
            <Search className={modelListClasses.searchIcon} />
            <input
              type="text"
              value={searchText}
              placeholder={t('models.search.placeholder')}
              disabled={isBusy}
              onChange={(event) => setSearchText(event.target.value)}
              className={modelListClasses.searchInput}
            />
            {searchText ? (
              <button
                type="button"
                onClick={() => setSearchText('')}
                className={modelListClasses.searchClear}
                aria-label={t('common.clear')}>
                <X size={9} />
              </button>
            ) : null}
          </div>
          {actions}
        </HStack>
      </HStack>

      {!hasNoModels ? (
        <ModelListCapabilityChips
          capabilityOptions={capabilityOptions}
          selectedCapabilityFilter={selectedCapabilityFilter}
          capabilityModelCounts={capabilityModelCounts}
          onSelectCapabilityFilter={setSelectedCapabilityFilter}
        />
      ) : null}
    </VStack>
  )
}

export default ModelListHeader
