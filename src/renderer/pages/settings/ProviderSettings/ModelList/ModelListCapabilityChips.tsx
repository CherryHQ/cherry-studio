import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Brain, Check, Code2, Filter, Gift, Globe, Grid2X2, Image, RotateCw, Wrench, X } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const activeFilter = selectedCapabilityFilter !== 'all'

  const visibleOptions = useMemo(
    () =>
      capabilityOptions.filter((filter) => {
        if (filter === 'all') {
          return true
        }
        return (capabilityModelCounts[filter] ?? 0) > 0
      }),
    [capabilityModelCounts, capabilityOptions]
  )

  const selectedLabel = t(CAPABILITY_FILTER_I18N_KEYS[selectedCapabilityFilter])
  const selectedCount = capabilityModelCounts[selectedCapabilityFilter] ?? 0

  return (
    <div className={modelListClasses.capabilityFilterRoot}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('settings.models.filter.label')}
            className={cn(
              modelListClasses.capabilityFilterButton,
              !activeFilter && modelListClasses.capabilityFilterButtonIconOnly,
              activeFilter && modelListClasses.capabilityFilterButtonActive
            )}>
            <Filter className={modelListClasses.capabilityTabIcon} />
            {activeFilter ? (
              <span className={modelListClasses.capabilityFilterLabel}>
                {selectedLabel} ({selectedCount})
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={modelListClasses.capabilityFilterMenu}>
          <MenuList className="gap-1">
            {visibleOptions.map((filter) => {
              const isActive = selectedCapabilityFilter === filter
              const label = t(CAPABILITY_FILTER_I18N_KEYS[filter])
              const count = capabilityModelCounts[filter] ?? 0
              const Icon = CAPABILITY_FILTER_ICONS[filter]

              return (
                <MenuItem
                  key={filter}
                  label={`${label} (${count})`}
                  active={isActive}
                  className={modelListClasses.capabilityFilterMenuItem}
                  icon={<Icon className={modelListClasses.capabilityTabIcon} />}
                  suffix={<Check className={cn('size-3.5', isActive ? 'opacity-100' : 'opacity-0')} />}
                  onClick={() => {
                    onSelectCapabilityFilter(filter)
                    setOpen(false)
                  }}
                />
              )
            })}
          </MenuList>
        </PopoverContent>
      </Popover>
      {activeFilter ? (
        <button
          type="button"
          className={modelListClasses.capabilityFilterClear}
          aria-label={t('settings.models.filter.clear')}
          onClick={() => onSelectCapabilityFilter('all')}>
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

export default ModelListCapabilityChips
