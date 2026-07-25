import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MODEL_ENDPOINT_OPTIONS, type ModelEndpointOption } from './helpers'
import type { ModelDrawerEndpointType } from './types'

interface ModelEndpointTypeChipsProps {
  value: readonly ModelDrawerEndpointType[]
  options?: readonly ModelEndpointOption[]
  onChange: (next: readonly ModelDrawerEndpointType[]) => void
}

export function ModelEndpointTypeChips({
  value,
  options = MODEL_ENDPOINT_OPTIONS,
  onChange
}: ModelEndpointTypeChipsProps) {
  const { t } = useTranslation()
  const selected = new Set(value)

  const toggle = (id: ModelDrawerEndpointType) => {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    // Keep the canonical option order, and preserve any already-selected endpoint the narrowed option
    // list doesn't render so toggling a chip can't silently drop it.
    const ordered = MODEL_ENDPOINT_OPTIONS.map((option) => option.id).filter((optionId) => next.has(optionId))
    onChange(ordered)
  }

  return (
    <div className={drawerClasses.endpointChipRow}>
      {options.map((option) => {
        const active = selected.has(option.id)
        return (
          <Button
            key={option.id}
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={active}
            className={active ? 'border border-border text-foreground' : undefined}
            onClick={() => toggle(option.id)}>
            {active ? <Check aria-hidden className="size-3" /> : null}
            {t(option.label)}
          </Button>
        )
      })}
    </div>
  )
}
