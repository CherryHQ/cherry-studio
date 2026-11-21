import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { HelpTooltip, Label, Switch } from '@cherrystudio/ui'

interface EndpointPathModeControlProps {
  checked: boolean
  endpointLabel: string
  onCheckedChange: (checked: boolean) => void
}

export function EndpointPathModeControl({ checked, endpointLabel, onCheckedChange }: EndpointPathModeControlProps) {
  const { t } = useTranslation()
  const id = useId()
  const label = t('settings.provider.api_host_exact_path')

  return (
    <div className="mt-2 flex items-center gap-2">
      <Switch
        id={id}
        size="sm"
        checked={checked}
        aria-label={`${endpointLabel}: ${label}`}
        onCheckedChange={onCheckedChange}
      />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <HelpTooltip content={t('settings.provider.api_host_exact_path_tooltip')} />
    </div>
  )
}
