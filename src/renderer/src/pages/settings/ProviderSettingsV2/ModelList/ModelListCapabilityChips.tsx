import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'

const CAPABILITY_FILTER_I18N_KEYS: Record<ModelListCapabilityFilter, string> = {
  all: 'models.all',
  reasoning: 'models.type.reasoning',
  vision: 'models.type.vision',
  websearch: 'models.type.websearch',
  free: 'models.type.free',
  embedding: 'models.type.embedding',
  rerank: 'models.type.rerank',
  function_calling: 'models.type.function_calling'
}

interface ModelListCapabilityChipsProps {
  capabilityOptions: readonly ModelListCapabilityFilter[]
  selectedCapabilityFilter: ModelListCapabilityFilter
  capabilityModelCounts: ModelListCapabilityCounts
  chipMaxWidth: number | undefined
  onSelectCapabilityFilter: (filter: ModelListCapabilityFilter) => void
}

const ModelListCapabilityChips: React.FC<ModelListCapabilityChipsProps> = ({
  capabilityOptions,
  selectedCapabilityFilter,
  capabilityModelCounts,
  chipMaxWidth,
  onSelectCapabilityFilter
}) => {
  const { t } = useTranslation()

  return (
    <div className={modelListClasses.chipRow}>
      {capabilityOptions
        .filter((filter) => {
          if (filter === 'all') {
            return true
          }
          return (capabilityModelCounts[filter] ?? 0) > 0
        })
        .map((filter) => {
          const isActive = selectedCapabilityFilter === filter
          const label = t(CAPABILITY_FILTER_I18N_KEYS[filter])
          const count = capabilityModelCounts[filter] ?? 0

          return (
            <button
              key={filter}
              type="button"
              onClick={() => onSelectCapabilityFilter(filter)}
              className={isActive ? modelListClasses.chipActive : modelListClasses.chipIdle}
              style={chipMaxWidth ? { maxWidth: chipMaxWidth } : undefined}>
              <span className={modelListClasses.chipLabel}>{label}</span>
              <span className={modelListClasses.chipCount}>{count}</span>
            </button>
          )
        })}
    </div>
  )
}

export default ModelListCapabilityChips
