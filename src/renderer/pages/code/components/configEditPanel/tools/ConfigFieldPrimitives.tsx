import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <span className="mb-1 block text-[10px] text-muted-foreground/60">{label}</span>
      {children}
    </div>
  )
}

export interface ConfigSelectOption {
  value: string
  label: string
}

const UNSET_SELECT_VALUE = '__cherry_unset__'

export function ConfigSelectField({
  label,
  value,
  placeholder,
  options,
  unsetLabel,
  onChange,
  className
}: {
  label: string
  value?: string
  placeholder?: string
  options: ConfigSelectOption[]
  unsetLabel?: string
  onChange: (value: string | undefined) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const selectOptions = unsetLabel ? [{ value: UNSET_SELECT_VALUE, label: unsetLabel }, ...options] : options

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  return (
    <Field label={label} className={cn('max-w-56 flex-none', className)}>
      <Select
        open={open}
        onOpenChange={setOpen}
        value={value ?? (unsetLabel ? UNSET_SELECT_VALUE : undefined)}
        onValueChange={(nextValue) => {
          onChange(nextValue === UNSET_SELECT_VALUE ? undefined : nextValue)
          setOpen(false)
        }}>
        <SelectTrigger ref={triggerRef} size="sm" className="h-8 w-full" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent ref={contentRef}>
          {selectOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
