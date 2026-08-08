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
 * sent over exactly one protocol. Built on native radio inputs so the browser supplies the group
 * semantics, arrow-key navigation and roving focus a button row would have to reimplement.
 */
export function ModelPreferredEndpointSelect({
  value,
  options,
  labelledBy,
  onChange
}: ModelPreferredEndpointSelectProps) {
  const { t } = useTranslation()
  const groupName = useId()

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={drawerClasses.endpointChipRow}>
      {options.map((option) => {
        const active = option === value
        const label = MODEL_ENDPOINT_OPTIONS.find((candidate) => candidate.id === option)?.label

        return (
          <label key={option}>
            <input
              type="radio"
              name={groupName}
              value={option}
              checked={active}
              className="peer sr-only"
              onChange={() => onChange(option)}
            />
            <span className={cn(drawerClasses.endpointRadioChip, active && drawerClasses.endpointRadioChipActive)}>
              {active ? <Check aria-hidden className="size-3" /> : null}
              {label ? t(label) : option}
            </span>
          </label>
        )
      })}
    </div>
  )
}
