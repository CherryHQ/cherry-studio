import { RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import type { EndpointType } from '@shared/data/types/model'
import { Check } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { MODEL_ENDPOINT_OPTIONS } from './helpers'

interface ModelPreferredEndpointSelectProps {
  value: EndpointType
  options: readonly EndpointType[]
  labelledBy?: string
  onChange: (next: EndpointType) => void
}

/**
 * Single-choice endpoint picker: exactly one option is always active, because a request is always
 * sent over exactly one protocol.
 */
export function ModelPreferredEndpointSelect({
  value,
  options,
  labelledBy,
  onChange
}: ModelPreferredEndpointSelectProps) {
  const { t } = useTranslation()
  const groupId = useId()

  return (
    <RadioGroup
      value={value}
      aria-labelledby={labelledBy}
      className={drawerClasses.endpointChipRow}
      onValueChange={(next) => onChange(next as EndpointType)}>
      {options.map((option) => {
        const active = option === value
        const label = MODEL_ENDPOINT_OPTIONS.find((candidate) => candidate.id === option)?.label
        const optionId = `${groupId}-${option}`

        return (
          <label key={option} htmlFor={optionId}>
            <RadioGroupItem id={optionId} value={option} className="peer sr-only" />
            <span className={cn(drawerClasses.endpointRadioChip, active && drawerClasses.endpointRadioChipActive)}>
              {active ? <Check aria-hidden className="size-3" /> : null}
              {label ? t(label) : option}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}
