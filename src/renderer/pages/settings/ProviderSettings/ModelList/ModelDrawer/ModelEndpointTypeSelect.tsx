import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { useTranslation } from 'react-i18next'

import { MODEL_ENDPOINT_OPTIONS } from './helpers'
import type { ModelDrawerEndpointType } from './types'

interface ModelEndpointTypeSelectProps {
  value: readonly ModelDrawerEndpointType[]
  onChange: (next: readonly ModelDrawerEndpointType[]) => void
}

export function ModelEndpointTypeSelect({ value, onChange }: ModelEndpointTypeSelectProps) {
  const { t } = useTranslation()
  const options: ComboboxOption[] = MODEL_ENDPOINT_OPTIONS.map((option) => ({
    value: option.id,
    label: t(option.label)
  }))

  const handleChange = (nextValue: string | string[]) => {
    const next = Array.isArray(nextValue) ? nextValue : [nextValue]
    const nextSet = new Set(next)
    const ordered = MODEL_ENDPOINT_OPTIONS.map((option) => option.id).filter((optionId) => nextSet.has(optionId))
    onChange(ordered)
  }

  return (
    <Combobox
      multiple
      searchable={false}
      options={options}
      value={[...value]}
      placeholder={t('settings.models.add.endpoint_type.placeholder')}
      className={cn(drawerClasses.selectTrigger, 'h-8 min-h-8 py-1')}
      popoverClassName="w-(--radix-popover-trigger-width)"
      renderValue={(selectedValues, availableOptions) => {
        const values = Array.isArray(selectedValues) ? selectedValues : [selectedValues]
        const labels = availableOptions.filter((option) => values.includes(option.value)).map((option) => option.label)

        return labels.length > 0 ? (
          <span className="min-w-0 flex-1 truncate text-left">{labels.join(', ')}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
            {t('settings.models.add.endpoint_type.placeholder')}
          </span>
        )
      }}
      onChange={handleChange}
    />
  )
}
