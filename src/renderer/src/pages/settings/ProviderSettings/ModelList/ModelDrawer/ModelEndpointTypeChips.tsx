import { cn } from '@renderer/utils'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../../shared/primitives/ProviderSettingsPrimitives'
import { MODEL_ENDPOINT_OPTIONS } from './helpers'
import type { ModelDrawerEndpointType } from './types'

interface ModelEndpointTypeChipsProps {
  value: readonly ModelDrawerEndpointType[]
  onChange: (next: readonly ModelDrawerEndpointType[]) => void
}

/** Multi-select endpoint types — same pill/chip interaction pattern as model-list capability chips. */
export function ModelEndpointTypeChips({ value, onChange }: ModelEndpointTypeChipsProps) {
  const { t } = useTranslation()
  const selected = new Set(value)

  const toggle = (id: ModelDrawerEndpointType) => {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    const ordered = MODEL_ENDPOINT_OPTIONS.map((option) => option.id).filter((optionId) =>
      next.has(optionId as ModelDrawerEndpointType)
    )
    onChange(ordered as ModelDrawerEndpointType[])
  }

  return (
    <div className={modelListClasses.chipRow}>
      {MODEL_ENDPOINT_OPTIONS.map((option) => {
        const active = selected.has(option.id as ModelDrawerEndpointType)
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            className={cn(active ? modelListClasses.chipActive : modelListClasses.chipIdle)}
            onClick={() => toggle(option.id as ModelDrawerEndpointType)}>
            <span className={modelListClasses.chipLabel}>{t(option.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
