import { RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import type { EndpointType } from '@shared/data/types/model'
import { Check } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { MODEL_ENDPOINT_OPTIONS } from './helpers'

/** Sentinel for "no pin" — a radio group needs a value, and `undefined` would make it uncontrolled. */
const INHERIT_VALUE = 'inherit'

interface ModelPreferredEndpointSelectProps {
  /** The pinned endpoint, or `undefined` when the model inherits its route. */
  value: EndpointType | undefined
  /** Where inheriting currently lands, shown so "inherit" is not a blind choice. */
  inheritedEndpoint: EndpointType | undefined
  options: readonly EndpointType[]
  labelledBy?: string
  onChange: (next: EndpointType | undefined) => void
}

function endpointLabelKey(endpointType: EndpointType): string | undefined {
  return MODEL_ENDPOINT_OPTIONS.find((candidate) => candidate.id === endpointType)?.label
}

/**
 * Single-choice endpoint picker: a request goes over exactly one protocol, so the options are
 * exclusive.
 *
 * "Inherit" is a real option rather than an absent one. Without it the picker would render the
 * *effective* route as selected while nothing was persisted — clicking that entry emits no change
 * (the radio value is unchanged), so the user could neither pin the shown default nor get back to
 * inheriting after pinning something else.
 */
export function ModelPreferredEndpointSelect({
  value,
  inheritedEndpoint,
  options,
  labelledBy,
  onChange
}: ModelPreferredEndpointSelectProps) {
  const { t } = useTranslation()
  const groupId = useId()
  const inheritedLabelKey = inheritedEndpoint ? endpointLabelKey(inheritedEndpoint) : undefined
  const entries: { key: string; label: string }[] = [
    {
      key: INHERIT_VALUE,
      label: inheritedLabelKey
        ? t('settings.models.add.preferred_endpoint.inherit_resolved', { endpoint: t(inheritedLabelKey) })
        : t('settings.models.add.preferred_endpoint.inherit')
    },
    ...options.map((option) => {
      const labelKey = endpointLabelKey(option)
      return { key: option, label: labelKey ? t(labelKey) : option }
    })
  ]

  return (
    <RadioGroup
      value={value ?? INHERIT_VALUE}
      aria-labelledby={labelledBy}
      className={drawerClasses.endpointChipRow}
      onValueChange={(next) => onChange(next === INHERIT_VALUE ? undefined : (next as EndpointType))}>
      {entries.map((entry) => {
        const active = (value ?? INHERIT_VALUE) === entry.key
        const optionId = `${groupId}-${entry.key}`

        return (
          <label key={entry.key} htmlFor={optionId}>
            <RadioGroupItem id={optionId} value={entry.key} className="peer sr-only" />
            <span className={cn(drawerClasses.endpointRadioChip, active && drawerClasses.endpointRadioChipActive)}>
              {active ? <Check aria-hidden className="size-3" /> : null}
              {entry.label}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}
