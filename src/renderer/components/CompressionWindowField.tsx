import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InputNumber, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { isValidCompressionWindow } from '@shared/utils/contextSettings'

export function CompressionWindowField({
  value,
  recent,
  onChange,
  inherited
}: {
  value: number | null | undefined
  recent: number | null
  onChange: (value: number | null | undefined) => void | Promise<unknown>
  inherited?: number | null
}) {
  const { t } = useTranslation()
  const id = useId()
  const [rejected, setRejected] = useState(false)
  const [draft, setDraft] = useState<number | null | undefined>(undefined)
  const effective = value === undefined ? inherited : value
  const invalid = rejected || !isValidCompressionWindow(recent, effective)
  const commit = (next: number | null | undefined) => {
    if (!isValidCompressionWindow(recent, next === undefined ? inherited : next)) {
      setRejected(true)
      setDraft(next)
      return
    }
    setRejected(false)
    setDraft(undefined)
    return onChange(next)
  }
  const enable = () =>
    commit(typeof inherited === 'number' && isValidCompressionWindow(recent, inherited) ? inherited : (recent ?? 0) + 1)

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm font-medium break-words">
          {t('settings.models.context_management.window_enabled')}
        </span>
        {inherited !== undefined ? (
          <Select
            value={value === undefined ? 'inherit' : value === null ? 'off' : 'custom'}
            onValueChange={(mode) => {
              if (mode === 'custom') void enable()
              else void commit(mode === 'inherit' ? undefined : null)
            }}>
            <SelectTrigger
              aria-describedby={invalid ? `${id}-error` : `${id}-description`}
              aria-invalid={invalid || undefined}
              aria-label={t('settings.models.context_management.window_enabled')}
              className="h-8 w-36 shrink-0 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t('settings.models.context_management.window_inherit')}</SelectItem>
              <SelectItem value="off">{t('settings.models.context_management.window_off')}</SelectItem>
              <SelectItem value="custom">{t('settings.models.context_management.window_custom')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Switch
            aria-label={t('settings.models.context_management.window_enabled')}
            aria-describedby={`${id}-description`}
            checked={typeof value === 'number'}
            onCheckedChange={(checked) => {
              if (checked) void enable()
              else void commit(null)
            }}
          />
        )}
      </div>
      <p id={`${id}-description`} className="text-xs leading-5 text-muted-foreground">
        {t('settings.models.context_management.window_description')}
      </p>
      {value === undefined && inherited !== undefined && (
        <p className="text-xs text-muted-foreground">
          {t('settings.models.context_management.window_rounds')}:{' '}
          {inherited ?? t('settings.models.context_management.window_off')}
        </p>
      )}
      {typeof value === 'number' && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm">
            {t('settings.models.context_management.window_rounds')}
          </label>
          <InputNumber
            id={id}
            value={draft === undefined ? value : draft}
            className="h-8 w-28 shrink-0 rounded-lg px-2.5"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onBlur={(next) => {
              if (next === null) {
                setRejected(true)
                setDraft(null)
                return
              }
              return commit(next)
            }}
          />
        </div>
      )}
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive">
          {t('settings.models.context_management.window_invalid')}
        </p>
      )}
    </div>
  )
}
