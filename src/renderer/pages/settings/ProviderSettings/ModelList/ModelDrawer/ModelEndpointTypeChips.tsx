import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'

import { MODEL_ENDPOINT_OPTIONS, toggleModelValue } from './helpers'
import type { ModelDrawerEndpointType } from './types'

interface ModelEndpointTypeChipsProps {
  value: readonly ModelDrawerEndpointType[]
  onChange: (next: readonly ModelDrawerEndpointType[]) => void
}

export function ModelEndpointTypeChips({ value, onChange }: ModelEndpointTypeChipsProps) {
  const { t } = useTranslation()
  const selected = new Set(value)

  const options = [
    ...MODEL_ENDPOINT_OPTIONS.map((option) => ({ id: option.id as ModelDrawerEndpointType, label: t(option.label) })),
    ...value.filter((id) => !MODEL_ENDPOINT_OPTIONS.some((option) => option.id === id)).map((id) => ({ id, label: id }))
  ]

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
            onClick={() => onChange(toggleModelValue(value, option.id))}>
            {active ? <Check aria-hidden className="size-3" /> : null}
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
