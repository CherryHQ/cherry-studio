import { CircleHelp } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox, type ComboboxOption, Label, Tooltip } from '@cherrystudio/ui'
import type { RuntimeApiKey } from '@shared/data/types/provider'

const AUTO_VALUE = '__auto__'

function formatKeyLabel(entry: RuntimeApiKey): string {
  const label = entry.label?.trim()
  if (label) return label
  return entry.id
}

interface ModelApiKeyFieldProps {
  apiKeys: readonly RuntimeApiKey[]
  value: string | null | undefined
  disabled?: boolean
  onChange: (apiKeyId: string | null) => void
}

export function ModelApiKeyField({ apiKeys, value, disabled, onChange }: ModelApiKeyFieldProps) {
  const { t } = useTranslation()
  const labelId = useId()

  const options: ComboboxOption[] = [
    { value: AUTO_VALUE, label: t('settings.models.edit.api_key.auto') },
    ...apiKeys.map((entry) => ({
      value: entry.id,
      label: formatKeyLabel(entry),
      description: entry.isEnabled ? undefined : t('settings.models.edit.api_key.disabled')
    }))
  ]

  const comboboxValue = value ?? AUTO_VALUE

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-1.5">
        <Label id={labelId} className="text-[13px] text-foreground">
          {t('settings.models.edit.api_key.label')}
        </Label>
        <Tooltip content={t('settings.models.edit.api_key.tooltip')}>
          <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
            <CircleHelp aria-hidden className="size-3" />
          </span>
        </Tooltip>
      </div>
      <Combobox
        aria-labelledby={labelId}
        className="h-9 w-full justify-between px-2.5 text-left text-[13px]"
        emptyText={t('common.no_results')}
        options={options}
        value={comboboxValue}
        disabled={disabled}
        onChange={(next) => {
          const selected = Array.isArray(next) ? (next[0] ?? AUTO_VALUE) : next
          onChange(selected === AUTO_VALUE ? null : selected)
        }}
        placeholder={t('settings.models.edit.api_key.label')}
        popoverClassName="w-(--radix-popover-trigger-width)"
        searchable={options.length > 6}
        searchPlaceholder={t('common.search')}
      />
    </div>
  )
}
