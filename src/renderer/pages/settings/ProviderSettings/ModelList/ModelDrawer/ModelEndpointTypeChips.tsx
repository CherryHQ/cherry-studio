import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
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
    <div className={drawerClasses.endpointChipRow}>
      {MODEL_ENDPOINT_OPTIONS.map((option) => {
        const active = selected.has(option.id as ModelDrawerEndpointType)
        return (
          <Button
            key={option.id}
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={active}
            onClick={() => toggle(option.id as ModelDrawerEndpointType)}>
            {t(option.label)}
          </Button>
        )
      })}
    </div>
  )
}
