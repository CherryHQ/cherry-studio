import { Check, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'

export function ImageParameterOptions({
  label,
  options,
  selected,
  disabled,
  format,
  onSelect,
  onChange
}: {
  label: string
  options: string[]
  selected?: string
  disabled: boolean
  format: (value: string) => string
  onSelect: (value: string) => void
  onChange: (options: string[], previous?: string, replacement?: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    const value = draft.trim()
    if (!value || options.some((option) => option === value && option !== editing)) {
      setInvalid(true)
      return
    }
    onChange(
      editing ? options.map((option) => (option === editing ? value : option)) : [...options, value],
      editing ?? undefined,
      value
    )
    setDraft('')
    setEditing(null)
    setInvalid(false)
  }
  return (
    <div role="group" aria-label={label} className="space-y-2 rounded-xl border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-normal">{label}</span>
        <span className="text-xs text-muted-foreground">{t('paintings.properties.default')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <span
            key={option}
            className={`group inline-flex items-center rounded-lg border ${selected === option ? 'border-primary bg-primary/10 text-primary' : 'border-border-subtle bg-muted/30'}`}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-h-7 gap-1.5 px-2.5 text-xs font-normal shadow-none"
              disabled={disabled}
              aria-pressed={selected === option}
              onClick={() => onSelect(option)}>
              {selected === option && <Check aria-hidden className="size-3" />}
              {format(option)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              disabled={disabled}
              aria-label={`${t('common.edit')} ${format(option)}`}
              onClick={() => {
                setEditing(option)
                setDraft(option)
                setInvalid(false)
              }}>
              <Pencil aria-hidden className="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-1 size-5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              disabled={disabled || options.length === 1}
              aria-label={`${t('common.delete')} ${format(option)}`}
              onClick={() => {
                onChange(options.filter((item) => item !== option))
                if (editing === option) {
                  setEditing(null)
                  setDraft('')
                }
              }}>
              <X aria-hidden className="size-3" />
            </Button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label={`${label} ${t(editing ? 'common.edit' : 'common.add')}`}
          className="h-7 min-w-0 text-xs"
          disabled={disabled}
          value={draft}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs font-normal"
          disabled={disabled}
          onClick={commit}>
          {t(editing ? 'common.save' : 'common.add')}
        </Button>
        {editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={() => {
              setEditing(null)
              setDraft('')
              setInvalid(false)
            }}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t('paintings.properties.invalid')}
        </p>
      )}
    </div>
  )
}
