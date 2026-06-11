import { Button } from '@cherrystudio/ui'
import { Brain, Code2, Gift, Globe, Grid2X2, Image, RotateCw, Wrench } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
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

const CAPABILITY_FILTER_ICONS: Record<ModelListCapabilityFilter, React.ComponentType<{ className?: string }>> = {
  all: Grid2X2,
  reasoning: Brain,
  vision: Image,
  websearch: Globe,
  free: Gift,
  embedding: Code2,
  rerank: RotateCw,
  function_calling: Wrench
}

interface ModelListCapabilityChipsProps {
  capabilityOptions: readonly ModelListCapabilityFilter[]
  selectedCapabilityFilter: ModelListCapabilityFilter
  capabilityModelCounts: ModelListCapabilityCounts
  onSelectCapabilityFilter: (filter: ModelListCapabilityFilter) => void
}

const ModelListCapabilityChips: React.FC<ModelListCapabilityChipsProps> = ({
  capabilityOptions,
  selectedCapabilityFilter,
  capabilityModelCounts,
  onSelectCapabilityFilter
}) => {
  const { t } = useTranslation()

  return (
    <div className={modelListClasses.capabilityTabsRoot}>
      <div className={modelListClasses.capabilityTabsList}>
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
            const Icon = CAPABILITY_FILTER_ICONS[filter]

            return (
              <Button
                key={filter}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isActive}
                onClick={(event) => {
                  onSelectCapabilityFilter(filter)
                  event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })
                }}
                className={isActive ? modelListClasses.capabilityTabActive : modelListClasses.capabilityTabIdle}>
                <Icon className={modelListClasses.capabilityTabIcon} />
                <span className={modelListClasses.capabilityTabLabel}>
                  {label} ({count})
                </span>
              </Button>
            )
          })}
      </div>
      <div className={modelListClasses.capabilityTabsFadeMask} aria-hidden />
    </div>
  )
}

export default ModelListCapabilityChips
