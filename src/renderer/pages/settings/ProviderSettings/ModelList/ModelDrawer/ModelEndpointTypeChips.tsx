import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MODEL_ENDPOINT_OPTIONS } from './helpers'
import type { ModelDrawerEndpointType } from './types'

interface ModelEndpointTypeChipsProps {
  value: readonly ModelDrawerEndpointType[]
  onChange: (next: readonly ModelDrawerEndpointType[]) => void
}

export function ModelEndpointTypeChips({ value, onChange }: ModelEndpointTypeChipsProps) {
  const { t } = useTranslation()
  const selected = new Set(value)

  const toggle = (id: ModelDrawerEndpointType) => {
    const next = new Set(selected)
    if (next.has(id)) {
      if (next.size <= 1) {
        return
      }
      next.delete(id)
    } else {
      next.add(id)
    }
    const ordered = MODEL_ENDPOINT_OPTIONS.map((option) => option.id).filter((optionId) => next.has(optionId))
    onChange(ordered)
  }

  return (
    <div className={drawerClasses.endpointChipRow}>
      {MODEL_ENDPOINT_OPTIONS.map((option) => {
        const active = selected.has(option.id)
        const isLastSelected = active && selected.size <= 1
        return (
          <Button
            key={option.id}
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={active}
            aria-disabled={isLastSelected}
            className={cn(active && 'border border-border text-foreground', isLastSelected && 'cursor-default')}
            onClick={() => toggle(option.id)}>
            {active ? <Check aria-hidden className="size-3" /> : null}
            {t(option.label)}
          </Button>
        )
      })}
    </div>
  )
}
