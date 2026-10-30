import { Clock3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

function TimeColumn({
  label,
  value,
  count,
  onChange
}: {
  label: string
  value: string
  count: number
  onChange: (value: string) => void
}) {
  const column = useRef<HTMLDivElement>(null)
  useEffect(() => {
    column.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [value])
  return (
    <div className="min-w-0">
      <p className="pb-2 text-center text-xs text-muted-foreground">{label}</p>
      <div
        ref={column}
        role="listbox"
        aria-label={label}
        className="h-56 space-y-1 overflow-y-auto px-1"
        onKeyDown={(event) => {
          const current = Number(value)
          const next =
            event.key === 'ArrowDown'
              ? (current + 1) % count
              : event.key === 'ArrowUp'
                ? (current + count - 1) % count
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? count - 1
                    : undefined
          if (next === undefined) return
          event.preventDefault()
          onChange(String(next).padStart(2, '0'))
          column.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus()
        }}>
        {Array.from({ length: count }, (_, index) => {
          const item = String(index).padStart(2, '0')
          return (
            <Button
              key={item}
              role="option"
              aria-selected={item === value}
              tabIndex={item === value ? 0 : -1}
              variant={item === value ? 'default' : 'ghost'}
              size="sm"
              className="w-full font-mono tabular-nums"
              onClick={() => onChange(item)}>
              {item}:00
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function BillingTimePicker({
  value,
  label,
  allowEndOfDay = false,
  invalid = false,
  onChange
}: {
  value: string
  label: string
  allowEndOfDay?: boolean
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const [hour] = value.split(':')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          aria-invalid={invalid}
          className={cn('w-full justify-between font-normal', invalid && 'border-destructive')}>
          <span className="font-mono tabular-nums">{value}</span>
          <Clock3 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="start"
        className="w-36 p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          content.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
        }}>
        <TimeColumn
          label={t('settings.provider.billing.hour')}
          value={hour}
          count={allowEndOfDay ? 25 : 24}
          onChange={(next) => onChange(`${next}:00`)}
        />
        <div className="mt-3 flex justify-end border-t border-border-subtle pt-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
